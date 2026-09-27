import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { criarConvites } from '../src/convites'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const db = client.db('wcoen_test_convites')

beforeEach(() => db.collection('convites').deleteMany({}))
afterAll(() => client.close())

describe('criarConvites', () => {
  it('criar gera um código, guarda quem criou e a nota; listar traz os mais recentes primeiro', async () => {
    const convites = await criarConvites(db)
    const a = await convites.criar('admin1', 'para a Ana')
    const b = await convites.criar('admin1')
    expect(a.codigo).toMatch(/^[0-9a-f]{10}$/)
    expect(a.codigo).not.toBe(b.codigo)
    expect(a.nota).toBe('para a Ana')
    expect(a.usadoEm).toBeUndefined()
    expect((await convites.listar()).map((c) => c.id)).toEqual([b.id, a.id])
  })

  it('existe: true para um código válido e não usado; false para inexistente', async () => {
    const convites = await criarConvites(db)
    const { codigo } = await convites.criar('admin1')
    expect(await convites.existe(codigo)).toBe(true)
    expect(await convites.existe('nao-existe')).toBe(false)
  })

  it('consumir marca como usado e devolve true; o mesmo código não serve de novo', async () => {
    const convites = await criarConvites(db)
    const { codigo, id } = await convites.criar('admin1')
    expect(await convites.consumir(codigo, 'conta1')).toBe(true)
    expect(await convites.consumir(codigo, 'conta2')).toBe(false)
    expect(await convites.existe(codigo)).toBe(false)
    const listado = (await convites.listar()).find((c) => c.id === id)
    expect(listado?.usadoEm).toBeInstanceOf(Date)
  })

  it('consumir código inexistente devolve false', async () => {
    const convites = await criarConvites(db)
    expect(await convites.consumir('nao-existe', 'conta1')).toBe(false)
  })

  it('revogar remove um convite não usado; não remove um já usado; id inválido devolve false', async () => {
    const convites = await criarConvites(db)
    const livre = await convites.criar('admin1')
    const usado = await convites.criar('admin1')
    await convites.consumir(usado.codigo, 'conta1')

    expect(await convites.revogar(livre.id)).toBe(true)
    expect(await convites.existe(livre.codigo)).toBe(false)
    expect(await convites.revogar(usado.id)).toBe(false)
    expect((await convites.listar()).some((c) => c.id === usado.id)).toBe(true)
    expect(await convites.revogar('não-é-objectid')).toBe(false)
  })
})
