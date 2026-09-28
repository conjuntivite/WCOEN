import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { criarConvites } from '../src/convites'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen'
const pool = new Pool({ connectionString: URL })

beforeEach(() => pool.query('DROP TABLE IF EXISTS convites'))
afterAll(() => pool.end())

describe('criarConvites', () => {
  it('criar gera um código, guarda quem criou e a nota; listar traz os mais recentes primeiro', async () => {
    const convites = await criarConvites(pool)
    const a = await convites.criar('admin1', 'para a Ana')
    const b = await convites.criar('admin1')
    expect(a.codigo).toMatch(/^[0-9a-f]{10}$/)
    expect(a.codigo).not.toBe(b.codigo)
    expect(a.nota).toBe('para a Ana')
    expect(a.usadoEm).toBeUndefined()
    expect((await convites.listar()).map((c) => c.id)).toEqual([b.id, a.id])
  })

  it('existe: true para um código válido e não usado; false para inexistente', async () => {
    const convites = await criarConvites(pool)
    const { codigo } = await convites.criar('admin1')
    expect(await convites.existe(codigo)).toBe(true)
    expect(await convites.existe('nao-existe')).toBe(false)
  })

  it('consumir é atômico: só um de dois cadastros simultâneos com o mesmo código vence', async () => {
    const convites = await criarConvites(pool)
    const { codigo } = await convites.criar('admin1')
    const [r1, r2] = await Promise.all([convites.consumir(codigo, 'contaA'), convites.consumir(codigo, 'contaB')])
    expect([r1, r2].filter(Boolean)).toHaveLength(1)
    expect(await convites.existe(codigo)).toBe(false)
  })

  it('revogar só remove convite ainda não usado; preserva o histórico de usados', async () => {
    const convites = await criarConvites(pool)
    const c = await convites.criar('admin1')
    await convites.consumir(c.codigo, 'contaA')
    expect(await convites.revogar(c.id)).toBe(false)
    expect((await convites.listar())).toHaveLength(1)

    const d = await convites.criar('admin1')
    expect(await convites.revogar(d.id)).toBe(true)
    expect((await convites.listar()).map((x) => x.id)).toEqual([c.id])
  })
})
