import { criarAuditorOpenRouter } from './auditar'
import { apagarAuth, criarAuthState, garantirTabelaAuth } from './authstate'
import { criarSocketBaileys } from './baileys'
import { loadConfig } from './config'
import { criarContas, criarLimitador } from './contas'
import { criarConvites } from './convites'
import { conectarPostgres } from './db'
import { criarMailer, criarMailerResend } from './mailer'
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
const contas = await criarContas(banco.pool, { convite: config.convite, convites, dev: config.dev })
const repo = await criarRepo(banco.pool)
await garantirTabelaAuth(banco.pool)

const mailer = config.resend ? criarMailerResend(config.resend) : config.smtp ? criarMailer(config.smtp) : undefined

// auditor só existe com OPENROUTER_API_KEY + OPENROUTER_MODEL; sem ele, o comando auditoria avisa que a IA está desligada
const auditor = config.openrouter ? criarAuditorOpenRouter(config.openrouter) : undefined

const sessoes = criarSessoes({
  criarAuth: (id) => criarAuthState(banco.pool, id, config.chaveCripto),
  apagarAuth: (id) => apagarAuth(banco.pool, id),
  criarSocket: criarSocketBaileys,
  criarService: (id) => new Service(repo.repoDe(id), undefined, auditor),
  grupoDa: async (id) => (await contas.porId(id))?.grupoId,
  salvarGrupo: (id, grupoId, nome) => contas.definirGrupo(id, grupoId, nome),
  marcarConectada: (id, conectada) => contas.marcarConectada(id, conectada),
  maxSessoes: config.maxSessoes,
})

const web = criarWeb({
  contas,
  sessoes,
  convites,
  repo,
  mailer,
  adminEmails: config.adminEmails,
  devEmail: config.dev?.email,
  limitador: criarLimitador(5, 15 * 60_000),
  cookieSeguro: Boolean(config.dominio),
  confiarProxy: Boolean(config.dominio),
  dominio: config.dominio,
})
web.listen(config.porta, () => console.log(`Portal em http://localhost:${config.porta}`))

// reabre as sessões que estavam conectadas antes do reinício, escalonadas
void sessoes.reabrir(await contas.conectadas())

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
  web.close()
  web.closeAllConnections()
  await sessoes.encerrar()
  await banco.close()
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
