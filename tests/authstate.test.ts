import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { apagarAuth, cifrar, criarAuthState, decifrar, garantirIndiceAuth, type DocAuth } from '../src/authstate'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const col = client.db('wcoen_test').collection<DocAuth>('wa_auth')
const chave = randomBytes(32)

beforeEach(async () => {
  await col.deleteMany({})
  await garantirIndiceAuth(col)
})
afterAll(() => client.close())

describe('cifrar/decifrar', () => {
  it('ida e volta; cada cifra é diferente; chave errada falha', () => {
    const c1 = cifrar('segredo', chave)
    expect(decifrar(c1, chave)).toBe('segredo')
    expect(cifrar('segredo', chave)).not.toBe(c1) // IV aleatório
    expect(() => decifrar(c1, randomBytes(32))).toThrow()
  })
})

describe('criarAuthState', () => {
  it('conta nova nasce com credenciais e as recupera depois de salvar', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    const b = await criarAuthState(col, 'c1', chave)
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId)
    expect(Buffer.from(b.state.creds.noiseKey.private).equals(Buffer.from(a.state.creds.noiseKey.private))).toBe(true)
  })

  it('grava, lê e apaga chaves de sinal', async () => {
    const { state } = await criarAuthState(col, 'c1', chave)
    await state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } })
    const lido = await state.keys.get('pre-key', ['1', '2'])
    expect(lido['1'].private.toString()).toBe('a')
    expect(lido['2']).toBeFalsy()
    await state.keys.set({ 'pre-key': { '1': null } })
    expect((await state.keys.get('pre-key', ['1']))['1']).toBeFalsy()
  })

  it('o documento bruto no Mongo não contém credencial em claro', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    await a.state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } })
    const bruto = JSON.stringify(await col.find({ contaId: 'c1' }).toArray())
    expect(bruto).not.toContain('noiseKey')
    expect(bruto).not.toContain('registrationId')
    expect(bruto).not.toContain('private')
  })

  it('contas são isoladas e apagarAuth só apaga a indicada', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    const b = await criarAuthState(col, 'c2', chave)
    await b.saveCreds()
    expect(b.state.creds.registrationId).not.toBe(a.state.creds.registrationId)
    await apagarAuth(col, 'c1')
    expect(await col.countDocuments({ contaId: 'c1' })).toBe(0)
    expect(await col.countDocuments({ contaId: 'c2' })).toBe(1)
  })

  it('CHAVE_CRIPTO errada: erro claro e as credenciais gravadas não são sobrescritas', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    const antes = await col.findOne({ contaId: 'c1', chave: 'creds' })
    await expect(criarAuthState(col, 'c1', randomBytes(32))).rejects.toThrow('CHAVE_CRIPTO')
    expect((await col.findOne({ contaId: 'c1', chave: 'creds' }))?.valor).toBe(antes?.valor)
  })
})
