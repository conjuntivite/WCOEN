import type { Pool } from 'pg'
import type { ContaCorrente, ContaCorrenteComSaldo, ContasDoCliente } from './types'

export type ErroContaCorrente = 'apelido_invalido' | 'apelido_em_uso' | 'nome_invalido'

const APELIDO = /^[a-z0-9_-]{1,20}$/
const MAX_NOME = 40

type Row = { id: string; apelido: string; nome: string; saldo_inicial: string; favorita: boolean; ativa: boolean; movimento?: string }
const paraConta = (r: Row): ContaCorrente => ({ id: r.id, apelido: r.apelido, nome: r.nome, saldoInicial: Number(r.saldo_inicial), favorita: r.favorita, ativa: r.ativa })
const comSaldo = (r: Row): ContaCorrenteComSaldo => ({ ...paraConta(r), saldo: Number(r.saldo_inicial) + Number(r.movimento ?? 0) })
const nomeLimpo = (nome: string) => nome.trim()
const nomeOk = (nome: string) => nome.length >= 1 && nome.length <= MAX_NOME

// precisa de `criarRepo(pool)` antes: a migração lê `lancamentos`
export async function criarContasCorrentes(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contas_correntes (
      id TEXT PRIMARY KEY,
      conta_id TEXT NOT NULL,
      apelido TEXT NOT NULL,
      nome TEXT NOT NULL,
      saldo_inicial BIGINT NOT NULL DEFAULT 0,
      favorita BOOLEAN NOT NULL DEFAULT false,
      ativa BOOLEAN NOT NULL DEFAULT true,
      criada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS contas_correntes_apelido ON contas_correntes (conta_id, apelido);
    CREATE UNIQUE INDEX IF NOT EXISTS contas_correntes_favorita ON contas_correntes (conta_id) WHERE favorita;
    -- migração: quem já tem lançamentos ganha a "Principal" e os lançamentos antigos passam a apontar para ela (idempotente)
    INSERT INTO contas_correntes (id, conta_id, apelido, nome, favorita)
    SELECT gen_random_uuid()::text, l.conta_id, 'principal', 'Principal', true
    FROM (SELECT DISTINCT conta_id FROM lancamentos) l
    WHERE NOT EXISTS (SELECT 1 FROM contas_correntes c WHERE c.conta_id = l.conta_id)
    ON CONFLICT DO NOTHING;
    UPDATE lancamentos l SET conta_corrente_id = c.id
    FROM contas_correntes c
    WHERE l.conta_corrente_id IS NULL AND c.conta_id = l.conta_id AND c.favorita;
  `)

  // idempotente e seguro contra corrida: o índice único (conta_id, apelido) descarta a segunda inserção
  const garantirPadrao = async (contaId: string) => {
    await pool.query(
      `INSERT INTO contas_correntes (id, conta_id, apelido, nome, favorita)
       SELECT gen_random_uuid()::text, $1, 'principal', 'Principal', true
       WHERE NOT EXISTS (SELECT 1 FROM contas_correntes WHERE conta_id = $1)
       ON CONFLICT DO NOTHING`,
      [contaId],
    )
  }

  // favorita primeiro, depois ativas, depois pela ordem de criação
  const listar = async (contaId: string): Promise<ContaCorrenteComSaldo[]> => {
    await garantirPadrao(contaId)
    const r = await pool.query<Row>(
      `SELECT c.id, c.apelido, c.nome, c.saldo_inicial, c.favorita, c.ativa,
              COALESCE(SUM(CASE
                WHEN l.tipo = 'receita' THEN l.valor
                WHEN l.tipo = 'despesa' THEN -l.valor
                WHEN l.conta_destino_id = c.id THEN l.valor
                ELSE -l.valor
              END), 0)::bigint AS movimento
       FROM contas_correntes c
       LEFT JOIN lancamentos l ON (l.conta_corrente_id = c.id OR l.conta_destino_id = c.id) AND l.desfeito_em IS NULL
       WHERE c.conta_id = $1
       GROUP BY c.id
       ORDER BY c.favorita DESC, c.ativa DESC, c.criada_em ASC, c.apelido ASC`,
      [contaId],
    )
    return r.rows.map(comSaldo)
  }

  const doCliente = (contaId: string): ContasDoCliente => ({
    async favorita() {
      const buscar = () => pool.query<Row>('SELECT * FROM contas_correntes WHERE conta_id = $1 AND favorita', [contaId])
      let r = await buscar()
      if (!r.rows[0]) {
        await garantirPadrao(contaId)
        r = await buscar()
      }
      if (!r.rows[0]) throw new Error(`cliente ${contaId} sem conta favorita`)
      return paraConta(r.rows[0])
    },
    async porApelido(apelido) {
      const r = await pool.query<Row>('SELECT * FROM contas_correntes WHERE conta_id = $1 AND apelido = $2', [contaId, apelido])
      return r.rows[0] ? paraConta(r.rows[0]) : null
    },
    async ativas() {
      return (await listar(contaId)).filter((c) => c.ativa)
    },
    async quantasAtivas() {
      await garantirPadrao(contaId)
      const r = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM contas_correntes WHERE conta_id = $1 AND ativa', [contaId])
      return r.rows[0].n
    },
    async nomes() {
      const r = await pool.query<{ id: string; nome: string }>('SELECT id, nome FROM contas_correntes WHERE conta_id = $1', [contaId])
      return Object.fromEntries(r.rows.map((x) => [x.id, x.nome]))
    },
    async porId(id) {
      const r = await pool.query<Row>('SELECT * FROM contas_correntes WHERE conta_id = $1 AND id = $2', [contaId, id])
      return r.rows[0] ? paraConta(r.rows[0]) : null
    },
  })

  return {
    doCliente,
    listar,

    async criar(contaId: string, { apelido, nome, saldoInicial }: { apelido: string; nome: string; saldoInicial: number }): Promise<{ ok: true; conta: ContaCorrente } | { ok: false; erro: ErroContaCorrente }> {
      const a = apelido.trim().toLowerCase()
      const n = nomeLimpo(nome)
      if (!APELIDO.test(a)) return { ok: false, erro: 'apelido_invalido' }
      if (!nomeOk(n)) return { ok: false, erro: 'nome_invalido' }
      await garantirPadrao(contaId) // a primeira conta do cliente é a Principal (favorita); esta entra como não favorita
      try {
        const r = await pool.query<Row>(
          `INSERT INTO contas_correntes (id, conta_id, apelido, nome, saldo_inicial) VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING *`,
          [contaId, a, n, saldoInicial],
        )
        return { ok: true, conta: paraConta(r.rows[0]) }
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return { ok: false, erro: 'apelido_em_uso' }
        throw err
      }
    },

    async editar(contaId: string, id: string, { nome, saldoInicial }: { nome: string; saldoInicial: number }): Promise<'ok' | 'nome_invalido' | 'nao_encontrada'> {
      const n = nomeLimpo(nome)
      if (!nomeOk(n)) return 'nome_invalido'
      const r = await pool.query('UPDATE contas_correntes SET nome = $3, saldo_inicial = $4 WHERE id = $1 AND conta_id = $2', [id, contaId, n, saldoInicial])
      return r.rowCount ? 'ok' : 'nao_encontrada'
    },

    // troca a favorita numa transação; o lock por cliente serializa favoritar simultâneos (o índice parcial único não deixa duas ao mesmo tempo)
    async favoritar(contaId: string, id: string): Promise<'ok' | 'nao_encontrada' | 'inativa'> {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`favorita:${contaId}`])
        const alvo = await c.query<{ ativa: boolean }>('SELECT ativa FROM contas_correntes WHERE id = $1 AND conta_id = $2 FOR UPDATE', [id, contaId])
        if (!alvo.rows[0]) {
          await c.query('ROLLBACK')
          return 'nao_encontrada'
        }
        if (!alvo.rows[0].ativa) {
          await c.query('ROLLBACK')
          return 'inativa'
        }
        await c.query('UPDATE contas_correntes SET favorita = false WHERE conta_id = $1 AND favorita', [contaId])
        await c.query('UPDATE contas_correntes SET favorita = true WHERE id = $1', [id])
        await c.query('COMMIT')
        return 'ok'
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        c.release()
      }
    },

    async definirAtiva(contaId: string, id: string, ativa: boolean): Promise<'ok' | 'nao_encontrada' | 'favorita'> {
      const r = await pool.query(`UPDATE contas_correntes SET ativa = $3 WHERE id = $1 AND conta_id = $2 ${ativa ? '' : 'AND NOT favorita'}`, [id, contaId, ativa])
      if (r.rowCount) return 'ok'
      const existe = await pool.query<{ favorita: boolean }>('SELECT favorita FROM contas_correntes WHERE id = $1 AND conta_id = $2', [id, contaId])
      return existe.rows[0]?.favorita ? 'favorita' : 'nao_encontrada'
    },
  }
}

export type ContasCorrentes = Awaited<ReturnType<typeof criarContasCorrentes>>
