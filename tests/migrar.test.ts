import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { migrarLegado } from '../src/migrar'
import { criarContas } from '../src/contas'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const db = client.db('wcoen_test_migrar')
const lanc = db.collection('lancamentos')
afterAll(() => client.close())

const doc = (msgId: string, extra: object = {}) => ({ tipo: 'despesa', conta: 'x', valor: 1, remetente: 'u', msgId, data: new Date(), enviadoEm: new Date(), desfeitoEm: null, ...extra })

beforeEach(async () => {
  await db.collection('contas').deleteMany({})
  await lanc.deleteMany({})
})

describe('migrarLegado', () => {
  it('atribui a conta aos lançamentos sem contaId, preserva os de outras contas e é idempotente', async () => {
    const contas = await criarContas(db, { convite: 'c' })
    const r = await contas.cadastrar('dono@x.com', 'senha-boa-123', 'c')
    if (!r.ok) throw new Error('cadastro')
    await lanc.insertMany([doc('1'), doc('2'), doc('3', { contaId: 'outra' })])

    expect(await migrarLegado(db, '  DONO@x.com ')).toBe(2)
    expect(await lanc.countDocuments({ contaId: r.conta.id })).toBe(2)
    expect(await lanc.countDocuments({ contaId: 'outra' })).toBe(1)
    expect(await migrarLegado(db, 'dono@x.com')).toBe(0)
  })

  it('conta inexistente: erro claro e nada é alterado', async () => {
    await lanc.insertOne(doc('1'))
    await expect(migrarLegado(db, 'ninguem@x.com')).rejects.toThrow('conta não encontrada')
    expect(await lanc.countDocuments({ contaId: { $exists: false } })).toBe(1)
  })
})
