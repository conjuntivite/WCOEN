import { criarAuditorOpenRouter } from './auditar'
import { apagarAuth, criarAuthState, garantirIndiceAuth, type DocAuth } from './authstate'
import { criarSocketBaileys } from './baileys'
import { loadConfig } from './config'
import { criarContas, criarLimitador } from './contas'
import { conectarMongo } from './repo'
import { Service } from './service'
import { criarSessoes } from './sessoes'
import { criarWeb } from './web'

const config = loadConfig()

let mongo: Awaited<ReturnType<typeof conectarMongo>>
try {
  mongo = await conectarMongo(config.mongoUri, config.mongoDb)
} catch (err) {
  console.error('Não consegui conectar ao Mongo (o container está de pé?):', (err as Error).message)
  process.exit(1)
}

const contas = await criarContas(mongo.db, { convite: config.convite })
const authCol = mongo.db.collection<DocAuth>('wa_auth')
await garantirIndiceAuth(authCol)

// auditor só existe com OPENROUTER_API_KEY + OPENROUTER_MODEL; sem ele, o comando auditoria avisa que a IA está desligada
const auditor = config.openrouter ? criarAuditorOpenRouter(config.openrouter) : undefined

const sessoes = criarSessoes({
  criarAuth: (id) => criarAuthState(authCol, id, config.chaveCripto),
  apagarAuth: (id) => apagarAuth(authCol, id),
  criarSocket: criarSocketBaileys,
  criarService: (id) => new Service(mongo.repoDe(id), undefined, auditor),
  grupoDa: async (id) => (await contas.porId(id))?.grupoId,
  salvarGrupo: (id, grupoId, nome) => contas.definirGrupo(id, grupoId, nome),
  marcarConectada: (id, conectada) => contas.marcarConectada(id, conectada),
  maxSessoes: config.maxSessoes,
})

const web = criarWeb({
  contas,
  sessoes,
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
  await mongo.close()
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
