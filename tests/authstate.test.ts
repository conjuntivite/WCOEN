import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { apagarAuth, cifrar, criarAuthState, decifrar, garantirTabelaAuth } from '../src/authstate'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen'
const pool = new Pool({ connectionString: URL })
const chave = randomBytes(32)

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS wa_auth')
  await garantirTabelaAuth(pool)
})
afterAll(() => pool.end())

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
    const a = await criarAuthState(pool, 'c1', chave)
    await a.saveCreds()
    const b = await criarAuthState(pool, 'c1', chave)
    expect(b.state.creds).toEqual(a.state.creds)
  })

  it('chave errada ao ler credenciais gravadas lança erro (nunca inventa credenciais novas)', async () => {
    const a = await criarAuthState(pool, 'c1', chave)
    await a.saveCreds()
    await expect(criarAuthState(pool, 'c1', randomBytes(32))).rejects.toThrow('CHAVE_CRIPTO')
  })

  it('apagarAuth remove só a conta indicada', async () => {
    const a = await criarAuthState(pool, 'c1', chave)
    await a.saveCreds()
    const b = await criarAuthState(pool, 'c2', chave)
    await b.saveCreds()
    await apagarAuth(pool, 'c1')
    const r = await pool.query('SELECT conta_id FROM wa_auth')
    expect(r.rows.map((x) => x.conta_id)).toEqual(['c2'])
  })

  it('grava, lê e apaga chaves de sinal', async () => {
    const a = await criarAuthState(pool, 'c1', chave)
    const par = { public: Buffer.from([1]), private: Buffer.from([2]) }
    await a.state.keys.set({ 'pre-key': { '1': par } })
    const lidas = await a.state.keys.get('pre-key', ['1'])
    expect(lidas['1']).toEqual(par)
    await a.state.keys.set({ 'pre-key': { '1': null } }) // null remove
    const depois = await a.state.keys.get('pre-key', ['1'])
    expect(depois['1']).toBeNull()
  })

  it('o valor bruto gravado no Postgres não contém credencial em claro', async () => {
    const a = await criarAuthState(pool, 'c1', chave)
    await a.saveCreds()
    const r = await pool.query('SELECT valor FROM wa_auth WHERE conta_id = $1 AND chave = $2', ['c1', 'creds'])
    const bruto = r.rows[0].valor
    expect(bruto).not.toContain('noiseKey')
    expect(bruto).not.toContain('registrationId')
    expect(bruto).not.toContain('private')
  })
})
