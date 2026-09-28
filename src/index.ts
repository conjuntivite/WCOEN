import { criarAuditorOpenRouter } from './auditar'
import { apagarAuth, criarAuthState, garantirTabelaAuth } from './authstate'
import { criarSocketBaileys } from './baileys'
import { loadConfig } from './config'
import { criarContas, criarLimitador } from './contas'
import { criarConvites } from './convites'
import { conectarPostgres } from './db'
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
await garantirTabelaAuth(banco.pool)

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
  adminEmails: config.adminEmails,
  limitador: criarLimitador(5, 15 * 60_000),
  cookieSeguro: Boolean(config.dominio),
  confiarProxy: Boolean(config.dominio),
})
web.listen(config.porta, () => console.log(`Portal em http://localhost:${config.porta}`))

// reabre as sessões que estavam conectadas antes do reinício, escalonadas
void sessoes.reabrir(await contas.conectadas())

let saindo = false
async function sair() {
  if (saindo) process.exit(1) // segundo sinal: sai já
  saindo = true
  web.close()
  web.closeAllConnections()
  await sessoes.encerrar()
  await banco.close()
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
