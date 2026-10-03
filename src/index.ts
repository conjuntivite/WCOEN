import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { criarAuditorOpenRouter } from './auditar'
import { apagarAuth, criarAuthState, garantirTabelaAuth } from './authstate'
import { criarSocketBaileys } from './baileys'
import { loadConfig } from './config'
import { criarContas, criarLimitador } from './contas'
import { criarContasCorrentes } from './contasCorrentes'
import { criarConvites } from './convites'
import { conectarPostgres } from './db'
import { criarMailer, criarMailerResend } from './mailer'
import { criarExtratorOpenRouter } from './nota'
import { criarRepo } from './repo'
import { Service } from './service'
import { criarSessoes } from './sessoes'
import { criarWeb } from './web'

const config = loadConfig()

let banco: Awaited<ReturnType<typeof conectarPostgres>>
try {
  banco = await conectarPostgres(config.databaseUrl)
} catch (err) {
  console.error('Não consegui conectar ao Postgres (a DATABASE_URL está certa?):', (err as Error).message)
  process.exit(1)
}

const convites = await criarConvites(banco.pool)
const contas = await criarContas(banco.pool, { convite: config.convite, convites })
const repo = await criarRepo(banco.pool)
const contasCorrentes = await criarContasCorrentes(banco.pool) // depois de criarRepo: a migração lê `lancamentos`
await garantirTabelaAuth(banco.pool)

const mailer = config.resend ? criarMailerResend(config.resend) : config.smtp ? criarMailer(config.smtp) : undefined

// auditor só existe com OPENROUTER_API_KEY + OPENROUTER_MODEL; sem ele, o comando auditoria avisa que a IA está desligada
const auditor = config.openrouter ? criarAuditorOpenRouter(config.openrouter) : undefined
// leitura de nota só existe com OPENROUTER_VISION_MODEL (modelo pago); sem ele, "/nota" avisa que está desligada
const extratorNota = config.openrouter?.visionModel ? criarExtratorOpenRouter({ apiKey: config.openrouter.apiKey, model: config.openrouter.visionModel }) : undefined

const sessoes = criarSessoes({
  criarAuth: (id) => criarAuthState(banco.pool, id, config.chaveCripto),
  apagarAuth: (id) => apagarAuth(banco.pool, id),
  criarSocket: criarSocketBaileys,
  criarService: (id) => new Service(repo.repoDe(id), contasCorrentes.doCliente(id), undefined, auditor),
  grupoDa: async (id) => (await contas.porId(id))?.grupoId,
  salvarGrupo: (id, grupoId, nome) => contas.definirGrupo(id, grupoId, nome),
  marcarConectada: (id, conectada) => contas.marcarConectada(id, conectada),
  maxSessoes: config.maxSessoes,
  notas: extratorNota && { extrator: extratorNota, baixar: (m) => downloadMediaMessage(m, 'buffer', {}) },
})

const web = criarWeb({
  contas,
  sessoes,
  convites,
  repo,
  contasCorrentes,
  mailer,
  adminEmails: config.adminEmails,
  limitador: criarLimitador(5, 15 * 60_000),
  cookieSeguro: Boolean(config.dominio),
  confiarProxy: Boolean(config.dominio),
  dominio: config.dominio,
})
web.listen(config.porta, () => console.log(`Portal em http://localhost:${config.porta}`))

// reabre as sessões que estavam conectadas antes do reinício, escalonadas
void sessoes.reabrir(await contas.conectadas())

// A validade já barra login e sessão; aqui o bot de quem venceu é desconectado (na hora de subir e a cada hora).
// ponytail: até 1 h de atraso entre o vencimento e o WhatsApp cair; encurtar o intervalo se isso importar.
const desconectarVencidas = () =>
  contas
    .vencidasConectadas()
    .then(async (ids) => {
      for (const id of ids) await sessoes.desconectar(id)
    })
    .catch((err) => console.error('vencidas:', err instanceof Error ? err.message : err))
await desconectarVencidas()
const vencimentos = setInterval(() => void desconectarVencidas(), 60 * 60_000)

// ponytail: "self-ping" para plataformas free-tier (ex.: Render) que hibernam o serviço sem tráfego
// HTTP por um tempo — comportamento observado, não uma garantia documentada da plataforma; se o
// critério de "atividade" mudar, ou a conta tiver uma cota de horas separada, isso sozinho não basta.
// Sem DOMINIO (dev local), o ping nem começa.
const autoPing = config.dominio ? setInterval(() => void fetch(`https://${config.dominio}/saude`).catch(() => {}), 10 * 60_000) : undefined

let saindo = false
async function sair() {
  if (saindo) process.exit(1) // segundo sinal: sai já
  saindo = true
  if (autoPing) clearInterval(autoPing)
  clearInterval(vencimentos)
  web.close()
  web.closeAllConnections()
  await sessoes.encerrar()
  await banco.close()
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
