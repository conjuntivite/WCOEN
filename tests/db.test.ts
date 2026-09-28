import { afterEach, describe, expect, it } from 'vitest'
import { conectarPostgres } from '../src/db'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen'
let fechar: (() => Promise<void>) | undefined

afterEach(async () => {
  await fechar?.()
  fechar = undefined
})

describe('conectarPostgres', () => {
  it('conecta e permite consultar; close() encerra o pool', async () => {
    const { pool, close } = await conectarPostgres(URL)
    fechar = close
    const r = await pool.query('SELECT 1 AS um')
    expect(r.rows[0]).toEqual({ um: 1 })
  })
})
