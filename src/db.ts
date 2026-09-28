import { Pool } from 'pg'

export async function conectarPostgres(url: string) {
  const pool = new Pool({
    connectionString: url,
    ssl: /[?&]sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
  })
  await pool.query('SELECT 1') // falha cedo se a DATABASE_URL estiver errada ou o banco estiver fora do ar
  pool.on('error', (err) => console.error('Erro na conexão ociosa do Postgres:', err))
  return { pool, close: () => pool.end() }
}
