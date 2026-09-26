import { loadConfig } from './config'
import { conectarMongo } from './repo'
import { Service } from './service'
import { iniciarWhatsApp } from './whatsapp'

const config = loadConfig()

let mongo: Awaited<ReturnType<typeof conectarMongo>>
try {
  mongo = await conectarMongo(config.mongoUri, config.mongoDb)
} catch (err) {
  console.error('Não consegui conectar ao Mongo (o container está de pé?):', (err as Error).message)
  process.exit(1)
}

const service = new Service(mongo.repo)
const wa = await iniciarWhatsApp({
  groupId: config.groupId,
  tratar: (msg, recuperada) => service.handle(msg, { recuperada }),
})

let saindo = false
async function sair() {
  if (saindo) process.exit(1) // segundo sinal: sai já
  saindo = true
  await wa.desligar()
  await mongo.close()
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
