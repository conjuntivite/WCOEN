import type { Pool } from 'pg'
import { intervaloDoMes, mesesTerminandoEm } from './period'
import type { Balancete, Intervalo, Lancamento, Leitura, MesSerie, Natureza, NovoLancamento, Repo, TipoLancamento } from './types'

type Row = {
  tipo: TipoLancamento
  conta: string
  valor: string // bigint volta como string no pg
  remetente: string
  msg_id: string
  data: Date
  enviado_em: Date
  desfeito_em: Date | null
  conta_corrente_id: string
  conta_destino_id: string | null
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
  contaCorrenteId: r.conta_corrente_id,
  ...(r.conta_destino_id && { contaDestinoId: r.conta_destino_id }),
})

class PgRepo implements Repo {
  constructor(
    private pool: Pool,
    private contaId: string,
  ) {}

  async add(l: NovoLancamento) {
    try {
      await this.pool.query(
        'INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em, conta_corrente_id, conta_destino_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [this.contaId, l.tipo, l.conta, l.valor, l.remetente, l.msgId, l.data, l.enviadoEm, l.contaCorrenteId, l.contaDestinoId ?? null],
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
       RETURNING l.tipo, l.conta, l.valor, l.remetente, l.msg_id, l.data, l.enviado_em, l.desfeito_em, l.conta_corrente_id, l.conta_destino_id`,
      [this.contaId],
    )
    return r.rows[0] ? paraLancamento(r.rows[0]) : null
  }

  async extrato(intervalo: { de: Date; ate: Date }, contaCorrenteId?: string) {
    const r = await this.pool.query<Row>(
      `SELECT tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em, conta_corrente_id, conta_destino_id FROM lancamentos
       WHERE conta_id = $1 AND desfeito_em IS NULL AND data >= $2 AND data < $3
         AND ($4::text IS NULL OR conta_corrente_id = $4 OR conta_destino_id = $4)
       ORDER BY data ASC, enviado_em ASC, id ASC`,
      [this.contaId, intervalo.de, intervalo.ate, contaCorrenteId ?? null],
    )
    return r.rows.map(paraLancamento)
  }

  async balancete(intervalo: Intervalo, contaCorrenteId?: string): Promise<Balancete> {
    const r = await this.pool.query<{ tipo: TipoLancamento; conta: string; total: string }>(
      `SELECT tipo, conta, SUM(valor)::bigint AS total FROM lancamentos
       WHERE ($1::text IS NULL OR conta_id = $1) AND desfeito_em IS NULL
         AND ($2::timestamptz IS NULL OR data >= $2)
         AND ($3::timestamptz IS NULL OR data < $3)
         AND ($4::text IS NULL OR conta_corrente_id = $4)
       GROUP BY tipo, conta
       ORDER BY total DESC, conta ASC`,
      [this.contaId, intervalo?.de ?? null, intervalo?.ate ?? null, contaCorrenteId ?? null],
    )
    const linhas = (t: Natureza) => r.rows.filter((g) => g.tipo === t).map((g) => ({ conta: g.conta, total: Number(g.total) }))
    return { receitas: linhas('receita'), despesas: linhas('despesa') }
  }

  async serieMensal(ate: Date, meses: number, contaCorrenteId?: string): Promise<MesSerie[]> {
    const lista = mesesTerminandoEm(ate, meses)
    const primeiro = lista[0]
    const ultimo = lista[lista.length - 1]
    // ponytail: -3 horas fixas = mesmo offset de period.ts (Brasil sem horário de verão desde 2019)
    const r = await this.pool.query<{ ano: number; mes: number; tipo: TipoLancamento; total: string }>(
      `SELECT EXTRACT(YEAR FROM loc)::int AS ano, EXTRACT(MONTH FROM loc)::int AS mes, tipo, SUM(valor)::bigint AS total
       FROM (
         SELECT tipo, valor, (data AT TIME ZONE 'UTC') - interval '3 hours' AS loc FROM lancamentos
         WHERE ($1::text IS NULL OR conta_id = $1) AND desfeito_em IS NULL AND data >= $2 AND data < $3
           AND ($4::text IS NULL OR conta_corrente_id = $4)
       ) t
       GROUP BY 1, 2, tipo`,
      [this.contaId, intervaloDoMes(primeiro.ano, primeiro.mes).de, intervaloDoMes(ultimo.ano, ultimo.mes).ate, contaCorrenteId ?? null],
    )
    const total = (ano: number, mes: number, tipo: Natureza) => Number(r.rows.find((x) => x.ano === ano && x.mes === mes && x.tipo === tipo)?.total ?? 0)
    return lista.map(({ ano, mes }) => ({ ano, mes, receitas: total(ano, mes, 'receita'), despesas: total(ano, mes, 'despesa') }))
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
    ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS conta_corrente_id TEXT;
    CREATE INDEX IF NOT EXISTS lancamentos_cc ON lancamentos (conta_corrente_id);
    ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS conta_destino_id TEXT;
    CREATE INDEX IF NOT EXISTS lancamentos_cc_destino ON lancamentos (conta_destino_id);
  `)
  return {
    repoDe: (contaId: string) => new PgRepo(pool, contaId) as Repo,
    leitura: (contaId: string) => new PgRepo(pool, contaId) as Leitura,
  }
}

export type Repositorio = Awaited<ReturnType<typeof criarRepo>>
