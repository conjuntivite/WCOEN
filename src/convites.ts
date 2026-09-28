import { randomBytes, randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

export type Convite = { id: string; codigo: string; nota?: string; criadoEm: Date; usadoEm?: Date }
type Row = { id: string; codigo: string; nota: string | null; criado_em: Date; usado_em: Date | null }

const paraConvite = (d: Row): Convite => ({ id: d.id, codigo: d.codigo, nota: d.nota ?? undefined, criadoEm: d.criado_em, usadoEm: d.usado_em ?? undefined })
const gerarCodigo = () => randomBytes(5).toString('hex') // 10 caracteres, fácil de digitar/colar

// Convites criados por um admin no painel: cada um vale para um único cadastro. O código
// mestre do .env (CONVITE) continua funcionando à parte, como plano B — ver src/contas.ts.
export async function criarConvites(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS convites (
      id TEXT PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      nota TEXT,
      criado_por TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL,
      usado_em TIMESTAMPTZ,
      usado_por TEXT
    )
  `)

  return {
    async criar(criadoPorContaId: string, nota?: string): Promise<Convite> {
      const notaLimpa = nota?.trim() || null
      const r = await pool.query<Row>(
        'INSERT INTO convites (id, codigo, nota, criado_por, criado_em) VALUES ($1,$2,$3,$4,now()) RETURNING id, codigo, nota, criado_em, usado_em',
        [randomUUID(), gerarCodigo(), notaLimpa, criadoPorContaId],
      )
      return paraConvite(r.rows[0])
    },

    async listar(): Promise<Convite[]> {
      const r = await pool.query<Row>('SELECT id, codigo, nota, criado_em, usado_em FROM convites ORDER BY criado_em DESC')
      return r.rows.map(paraConvite)
    },

    // "peek" sem mutar: usado para dar a mensagem de erro certa antes de validar e-mail/senha
    async existe(codigo: string): Promise<boolean> {
      const r = await pool.query('SELECT 1 FROM convites WHERE codigo = $1 AND usado_em IS NULL LIMIT 1', [codigo.trim()])
      return (r.rowCount ?? 0) > 0
    },

    // atômico: dois cadastros simultâneos com o mesmo código nunca passam os dois
    async consumir(codigo: string, contaId: string): Promise<boolean> {
      const r = await pool.query(
        'UPDATE convites SET usado_em = now(), usado_por = $2 WHERE codigo = $1 AND usado_em IS NULL',
        [codigo.trim(), contaId],
      )
      return (r.rowCount ?? 0) > 0
    },

    // só remove convites ainda não usados (preserva o histórico dos já usados)
    async revogar(id: string): Promise<boolean> {
      const r = await pool.query('DELETE FROM convites WHERE id = $1 AND usado_em IS NULL', [id])
      return (r.rowCount ?? 0) > 0
    },
  }
}

export type Convites = Awaited<ReturnType<typeof criarConvites>>
