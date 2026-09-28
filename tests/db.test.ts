import { afterEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { conectarPostgres, configPostgres } from '../src/db'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen_test'
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

  // Sem conectar de verdade: o Postgres local de teste não fala SSL, então isto só confere a config que
  // conectarPostgres monta (a mesma que o `pg` usaria para negociar TLS contra o Supabase).
  it('com sslmode=require, o ssl efetivo do Pool é { rejectUnauthorized: false } (não some sob o parser interno do pg)', () => {
    const pool = new Pool(configPostgres(URL + '?sslmode=require'))
    expect(pool.options.ssl).toEqual({ rejectUnauthorized: false })
    return pool.end()
  })

  it('sem sslmode=require, o ssl efetivo do Pool é undefined', () => {
    const pool = new Pool(configPostgres(URL))
    expect(pool.options.ssl).toBeUndefined()
    return pool.end()
  })
})
