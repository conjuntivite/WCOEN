import { afterAll } from 'vitest'
import { MongoClient } from 'mongodb'
import { conectarMongo } from '../src/repo'
import { repoContract } from './repo.contract'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const DB = 'wcoen_test'

const limpador = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const fechar: Array<() => Promise<void>> = []

repoContract('MongoRepo', async () => {
  await limpador.db(DB).collection('lancamentos').deleteMany({})
  const { repo, close } = await conectarMongo(URI, DB)
  fechar.push(close)
  return repo
})

afterAll(async () => {
  await Promise.all(fechar.map((f) => f()))
  await limpador.close()
})
