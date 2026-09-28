import { Pool } from 'pg'

// O driver `pg` reprocessa `connectionString` internamente (pg-connection-string) e SOBRESCREVE o `ssl`
// explícito com o que ele mesmo deriva da URL. Com `?sslmode=require`, essa derivação vira `{}` (verificação
// completa do certificado), descartando silenciosamente nosso `rejectUnauthorized: false`. Por isso removemos
// `sslmode` da URL antes de repassá-la, e decidimos o `ssl` só pela regex, fora do controle do parser interno.
// Exportado à parte para dar pra testar a decisão de SSL sem precisar abrir uma conexão de verdade.
export function configPostgres(url: string) {
  const usaSSL = /[?&]sslmode=require/.test(url)
  const urlSemSslmode = url.replace(/\?sslmode=require&?/, '?').replace(/&sslmode=require/, '').replace(/\?$/, '')
  return {
    connectionString: urlSemSslmode,
    ssl: usaSSL ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 10_000, // ponytail: falha rápido num host que engole pacotes em vez de recusar
  }
}

export async function conectarPostgres(url: string) {
  const pool = new Pool(configPostgres(url))
  pool.on('error', (err) => console.error('Erro na conexão ociosa do Postgres:', err))
  await pool.query('SELECT 1') // falha cedo se a DATABASE_URL estiver errada ou o banco estiver fora do ar
  return { pool, close: () => pool.end() }
}
