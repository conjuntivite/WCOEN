import { Pool } from 'pg'

// Roda antes da suíte (setupFiles): garante que o banco de teste existe, sem nunca tocar no banco de
// desenvolvimento/produção (TEST_DATABASE_URL tem um default próprio, separado de DATABASE_URL).
const URL_TESTE = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen_test'

// `setupFiles` só importa o arquivo (não chama export default), então o bootstrap roda no topo do módulo.
const alvo = new URL(URL_TESTE)
const nomeBanco = alvo.pathname.slice(1)
const manutencao = new URL(URL_TESTE)
manutencao.pathname = '/postgres' // banco de manutenção, sempre presente num Postgres
const pool = new Pool({ connectionString: manutencao.toString() })
try {
  await pool.query(`CREATE DATABASE "${nomeBanco}"`)
} catch (err) {
  if ((err as { code?: string }).code !== '42P04') throw err // 42P04: banco já existe
} finally {
  await pool.end()
}
