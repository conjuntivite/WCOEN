import { afterAll, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { conectarMongo } from '../src/repo'
import { repoContract } from './repo.contract'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const DB = 'wcoen_test'

const limpador = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const fechar: Array<() => Promise<void>> = []

async function abrir() {
  await limpador.db(DB).collection('lancamentos').deleteMany({})
  const { repoDe, close } = await conectarMongo(URI, DB)
  fechar.push(close)
  return repoDe
}

repoContract(
  'MongoRepo',
  async () => (await abrir())('conta-teste'),
  async () => {
    const repoDe = await abrir()
    return [repoDe('a'), repoDe('b')]
  },
)

it('conectarMongo remove o índice único antigo só de msgId (dados legados)', async () => {
  const col = limpador.db(DB).collection('lancamentos')
  await col.deleteMany({})
  await col.createIndex({ msgId: 1 }, { unique: true, name: 'msgId_1' })
  const { repoDe, close } = await conectarMongo(URI, DB)
  fechar.push(close)
  const l = { tipo: 'despesa' as const, conta: 'x', valor: 1, remetente: 'u', msgId: 'igual', data: new Date(), enviadoEm: new Date() }
  expect(await repoDe('a').add(l)).toBe('ok')
  expect(await repoDe('b').add(l)).toBe('ok')
})

afterAll(async () => {
  await Promise.all(fechar.map((f) => f()))
  await limpador.close()
})
