import type { Pool } from 'pg'
import type { Balancete, Intervalo, Lancamento, Natureza, NovoLancamento, Repo } from './types'

type Row = {
  tipo: Natureza
  conta: string
  valor: string // bigint volta como string no pg
  remetente: string
  msg_id: string
  data: Date
  enviado_em: Date
  desfeito_em: Date | null
}
const paraLancamento = (r: Row): Lancamento => ({
  tipo: r.tipo,
  conta: r.conta,
  valor: Number(r.valor),
  remetente: r.remetente,
  msgId: r.msg_id,
  data: r.data,
  enviadoEm: r.enviado_em,
  desfeitoEm: r.desfeito_em,
})

class PgRepo implements Repo {
  constructor(
    private pool: Pool,
    private contaId: string,
  ) {}

  async add(l: NovoLancamento) {
    try {
      await this.pool.query(
        'INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [this.contaId, l.tipo, l.conta, l.valor, l.remetente, l.msgId, l.data, l.enviadoEm],
      )
      return 'ok' as const
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return 'duplicado' as const // índice único (conta_id, msg_id)
      throw err
    }
  }

  async desfazerUltimo() {
    const r = await this.pool.query<Row>(
      `WITH alvo AS (
         SELECT id FROM lancamentos WHERE conta_id = $1 AND desfeito_em IS NULL
         ORDER BY enviado_em DESC, id DESC LIMIT 1
       )
       UPDATE lancamentos l SET desfeito_em = now()
       FROM alvo WHERE l.id = alvo.id AND l.desfeito_em IS NULL
       RETURNING l.tipo, l.conta, l.valor, l.remetente, l.msg_id, l.data, l.enviado_em, l.desfeito_em`,
      [this.contaId],
    )
    return r.rows[0] ? paraLancamento(r.rows[0]) : null
  }

  async extrato(intervalo: { de: Date; ate: Date }) {
    const r = await this.pool.query<Row>(
      `SELECT tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em FROM lancamentos
       WHERE conta_id = $1 AND desfeito_em IS NULL AND data >= $2 AND data < $3
       ORDER BY data ASC, enviado_em ASC, id ASC`,
      [this.contaId, intervalo.de, intervalo.ate],
    )
    return r.rows.map(paraLancamento)
  }

  async balancete(intervalo: Intervalo): Promise<Balancete> {
    const r = await this.pool.query<{ tipo: Natureza; conta: string; total: string }>(
      `SELECT tipo, conta, SUM(valor)::bigint AS total FROM lancamentos
       WHERE conta_id = $1 AND desfeito_em IS NULL
         AND ($2::timestamptz IS NULL OR data >= $2)
         AND ($3::timestamptz IS NULL OR data < $3)
       GROUP BY tipo, conta
       ORDER BY total DESC, conta ASC`,
      [this.contaId, intervalo?.de ?? null, intervalo?.ate ?? null],
    )
    const linhas = (t: Natureza) => r.rows.filter((g) => g.tipo === t).map((g) => ({ conta: g.conta, total: Number(g.total) }))
    return { receitas: linhas('receita'), despesas: linhas('despesa') }
  }
}

export async function criarRepo(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lancamentos (
      id BIGSERIAL PRIMARY KEY,
      conta_id TEXT NOT NULL,
      tipo TEXT NOT NULL,
      conta TEXT NOT NULL,
      valor BIGINT NOT NULL,
      remetente TEXT NOT NULL,
      msg_id TEXT NOT NULL,
      data TIMESTAMPTZ NOT NULL,
      enviado_em TIMESTAMPTZ NOT NULL,
      desfeito_em TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_conta_msg ON lancamentos (conta_id, msg_id);
    CREATE INDEX IF NOT EXISTS lancamentos_conta_data ON lancamentos (conta_id, data);
  `)
  return {
    repoDe: (contaId: string) => new PgRepo(pool, contaId) as Repo,
    apagarConta: (contaId: string) => pool.query('DELETE FROM lancamentos WHERE conta_id = $1', [contaId]).then(() => undefined),
  }
}

export type Repositorio = Awaited<ReturnType<typeof criarRepo>>
