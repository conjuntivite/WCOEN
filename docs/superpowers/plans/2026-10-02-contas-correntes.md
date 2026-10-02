# Contas correntes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente cadastra uma ou mais contas correntes no portal, marca uma como favorita, e cada lançamento do WhatsApp vai para a favorita, ou para outra indicada com `@apelido` no comando.

**Architecture:** Nova entidade `ContaCorrente` (tabela `contas_correntes`, coluna `lancamentos.conta_corrente_id`) com CRUD em `src/contasCorrentes.ts`, no padrão de `contas.ts`. O `Service` ganha uma porta por cliente (`ContasDoCliente`) para resolver favorita e apelido; `Repo` ganha filtro opcional por conta corrente. O portal ganha `/contas-correntes` e o dashboard um seletor.

**Tech Stack:** TypeScript (ESM, Node >= 20.6), `pg`, vitest, HTML renderizado por template string (sem framework).

**Spec:** `docs/superpowers/specs/2026-10-02-contas-correntes-design.md`

## Global Constraints

- Idioma: mensagens, rótulos de tela e comentários em pt-BR; identificadores de código no padrão do projeto (já em pt-BR).
- No código a entidade se chama `ContaCorrente` / `contas_correntes` / `conta_corrente_id`; "conta" sozinho continua sendo o login do cliente (`conta_id`) e a descrição do lançamento (`conta`).
- Apelido: minúsculo, `[a-z0-9_-]{1,20}`, único por cliente, imutável depois de criado. Nome: até 40 caracteres.
- Saldo em centavos (`BIGINT`), pode ser negativo. `saldo atual = saldo_inicial + receitas − despesas` dos lançamentos da conta, sem desfeitos, de todas as datas, calculado em SQL.
- No máximo uma favorita por cliente (`UNIQUE (conta_id) WHERE favorita`); a favorita está sempre ativa; não há exclusão, só desativar.
- Só conta ativa recebe lançamento novo; desativadas continuam nos relatórios e nos filtros.
- Sem `@`, `/b` e `/e` somam todas as contas (ativas e desativadas); `/auditoria` ignora filtro e com `@` devolve a dica de uso.
- Confirmação do lançamento mostra o nome da conta só quando o cliente tem 2 ou mais contas ativas.
- `/contas` (atalho `/c`) lista só as contas ativas.
- Sem dependência nova. Postgres 16 (`gen_random_uuid()` nativo).
- Os testes de Postgres exigem `docker compose up -d postgres`.

## Review Focus

- Descrição com `@` no meio (`/d pix @joao 50`): o `@joao` vira conta; se não existir, o bot responde "conta não encontrada" e não grava nada (coberto em Task 4).
- Dois `@` no mesmo comando (`/d mercado 45 @a @b`): dica de uso, nada gravado (Task 3).
- Apelido digitado em maiúsculas (`@NuBank`): o parser já minusculiza a mensagem inteira, então resolve para `nubank` (Task 3).
- Cliente existente com lançamentos antigos: a migração cria a "Principal" e aponta todos os lançamentos antigos; rodar duas vezes não duplica (Task 1).
- Cliente novo sem nenhuma conta: o primeiro lançamento cria a "Principal" sozinho, duas requisições simultâneas não criam duas (Task 1).
- Desativar a favorita, favoritar conta desativada e mexer na conta de outro cliente são recusados (Tasks 1 e 5).
- Saldo inicial digitado no portal como `-50`, `1.234,56`, vazio ou lixo (`abc`): vale `-5000`, `123456`, `0` e erro de validação, respectivamente (Task 5).
- Dashboard com `?cc=` de apelido inexistente ou de outro cliente: ignora e mostra todas as contas (Task 6).

---

### Task 1: Camada de dados das contas correntes

**Files:**
- Create: `src/contasCorrentes.ts`
- Create: `tests/contasCorrentes.test.ts`
- Modify: `src/types.ts` (acrescentar tipos no fim)
- Modify: `src/repo.ts:102-118` (coluna nova em `lancamentos`)

**Interfaces:**
- Consumes: tabela `lancamentos` (criada por `criarRepo`).
- Produces (usado pelas Tasks 2–6):
  - `types.ts`: `ContaCorrente = { id; apelido; nome; saldoInicial: number; favorita: boolean; ativa: boolean }`, `ContaCorrenteComSaldo = ContaCorrente & { saldo: number }`, `interface ContasDoCliente { favorita(): Promise<ContaCorrente>; porApelido(apelido: string): Promise<ContaCorrente | null>; ativas(): Promise<ContaCorrenteComSaldo[]> }`.
  - `contasCorrentes.ts`: `criarContasCorrentes(pool: Pool)` devolvendo `{ doCliente(contaId): ContasDoCliente; listar(contaId): Promise<ContaCorrenteComSaldo[]>; criar(contaId, { apelido, nome, saldoInicial }): Promise<{ ok: true; conta: ContaCorrente } | { ok: false; erro: ErroContaCorrente }>; editar(contaId, id, { nome, saldoInicial }): Promise<'ok' | 'nome_invalido' | 'nao_encontrada'>; favoritar(contaId, id): Promise<'ok' | 'nao_encontrada' | 'inativa'>; definirAtiva(contaId, id, ativa): Promise<'ok' | 'nao_encontrada' | 'favorita'> }`; `type ErroContaCorrente = 'apelido_invalido' | 'apelido_em_uso' | 'nome_invalido'`; `type ContasCorrentes = Awaited<ReturnType<typeof criarContasCorrentes>>`.
  - Pré-requisito de uso: `criarRepo(pool)` roda antes (a migração lê `lancamentos`).

- [ ] **Step 1: Tipos novos em `src/types.ts`** (acrescentar ao fim do arquivo)

```ts
export type ContaCorrente = { id: string; apelido: string; nome: string; saldoInicial: number; favorita: boolean; ativa: boolean }
export type ContaCorrenteComSaldo = ContaCorrente & { saldo: number }
// as contas correntes de UM cliente, como o Service as enxerga
export interface ContasDoCliente {
  favorita(): Promise<ContaCorrente> // cria a "Principal" se o cliente ainda não tem nenhuma
  porApelido(apelido: string): Promise<ContaCorrente | null> // ativa ou não: quem chama decide se ativa basta
  ativas(): Promise<ContaCorrenteComSaldo[]> // favorita primeiro
}
```

- [ ] **Step 2: Coluna nova em `lancamentos`** — em `src/repo.ts`, dentro do `pool.query` de `criarRepo`, depois da linha do `CREATE INDEX IF NOT EXISTS lancamentos_conta_data ...`, acrescente:

```sql
    ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS conta_corrente_id TEXT;
    CREATE INDEX IF NOT EXISTS lancamentos_cc ON lancamentos (conta_corrente_id);
```

- [ ] **Step 3: Escrever o teste que falha** — `tests/contasCorrentes.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { criarRepo } from '../src/repo'
import { criarContasCorrentes, type ContasCorrentes } from '../src/contasCorrentes'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen_test'
const pool = new Pool({ connectionString: URL })
let cc: ContasCorrentes

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS contas_correntes')
  await pool.query('DROP TABLE IF EXISTS lancamentos')
  await criarRepo(pool)
  cc = await criarContasCorrentes(pool)
})
afterAll(() => pool.end())

const lancar = (contaId: string, contaCorrenteId: string | null, tipo: 'receita' | 'despesa', valor: number, desfeito = false) =>
  pool.query(
    `INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em, conta_corrente_id)
     VALUES ($1,$2,'x',$3,'u',gen_random_uuid()::text,now(),now(),$4,$5)`,
    [contaId, tipo, valor, desfeito ? new Date() : null, contaCorrenteId],
  )

describe('conta padrão', () => {
  it('o primeiro uso cria a "Principal" favorita; chamar de novo não duplica', async () => {
    const a = await cc.doCliente('c1').favorita()
    expect(a).toMatchObject({ apelido: 'principal', nome: 'Principal', favorita: true, ativa: true, saldoInicial: 0 })
    expect((await cc.doCliente('c1').favorita()).id).toBe(a.id)
    expect(await cc.listar('c1')).toHaveLength(1)
  })

  it('duas chamadas simultâneas criam uma só', async () => {
    await Promise.all([cc.doCliente('c2').favorita(), cc.doCliente('c2').favorita()])
    expect(await cc.listar('c2')).toHaveLength(1)
  })

  it('cada cliente tem a sua', async () => {
    const a = await cc.doCliente('c1').favorita()
    const b = await cc.doCliente('c2').favorita()
    expect(a.id).not.toBe(b.id)
  })
})

describe('migração', () => {
  it('cliente com lançamentos antigos ganha a Principal e os lançamentos apontam para ela; rodar de novo não duplica', async () => {
    await lancar('antigo', null, 'despesa', 500)
    await lancar('antigo', null, 'receita', 900)
    await criarContasCorrentes(pool)
    await criarContasCorrentes(pool)
    const lista = await cc.listar('antigo')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ apelido: 'principal', favorita: true, saldo: 400 })
    const r = await pool.query('SELECT count(*)::int AS n FROM lancamentos WHERE conta_id = $1 AND conta_corrente_id IS NULL', ['antigo'])
    expect(r.rows[0].n).toBe(0)
  })
})

describe('criar', () => {
  it('cria conta não favorita, com apelido minúsculo e saldo inicial', async () => {
    const r = await cc.criar('c1', { apelido: ' Nubank ', nome: 'Nubank', saldoInicial: 150000 })
    expect(r.ok && r.conta).toMatchObject({ apelido: 'nubank', nome: 'Nubank', saldoInicial: 150000, favorita: false, ativa: true })
    const lista = await cc.listar('c1')
    expect(lista.map((c) => c.apelido)).toEqual(['principal', 'nubank']) // favorita primeiro
  })

  it('recusa apelido inválido, repetido (mesmo cliente) e nome vazio ou longo; outro cliente pode repetir', async () => {
    expect(await cc.criar('c1', { apelido: 'com espaço', nome: 'X', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_invalido' })
    expect(await cc.criar('c1', { apelido: 'a'.repeat(21), nome: 'X', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_invalido' })
    expect(await cc.criar('c1', { apelido: 'ação', nome: 'X', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_invalido' })
    expect(await cc.criar('c1', { apelido: 'nubank', nome: '  ', saldoInicial: 0 })).toEqual({ ok: false, erro: 'nome_invalido' })
    expect(await cc.criar('c1', { apelido: 'nubank', nome: 'x'.repeat(41), saldoInicial: 0 })).toEqual({ ok: false, erro: 'nome_invalido' })
    expect((await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })).ok).toBe(true)
    expect(await cc.criar('c1', { apelido: 'NUBANK', nome: 'Outro', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_em_uso' })
    expect(await cc.criar('c1', { apelido: 'principal', nome: 'Outro', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_em_uso' })
    expect((await cc.criar('c2', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })).ok).toBe(true)
  })
})

describe('porApelido e ativas', () => {
  it('porApelido acha ativa e desativada, e só do próprio cliente', async () => {
    await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = (await cc.doCliente('c1').porApelido('nubank'))!.id
    await cc.definirAtiva('c1', id, false)
    expect(await cc.doCliente('c1').porApelido('nubank')).toMatchObject({ ativa: false })
    expect(await cc.doCliente('c2').porApelido('nubank')).toBeNull()
    expect(await cc.doCliente('c1').porApelido('nao-existe')).toBeNull()
  })

  it('ativas lista só as ativas, favorita primeiro', async () => {
    await cc.criar('c1', { apelido: 'b', nome: 'B', saldoInicial: 0 })
    await cc.criar('c1', { apelido: 'a', nome: 'A', saldoInicial: 0 })
    const b = (await cc.doCliente('c1').porApelido('b'))!
    await cc.definirAtiva('c1', b.id, false)
    expect((await cc.doCliente('c1').ativas()).map((c) => c.apelido)).toEqual(['principal', 'a'])
  })
})

describe('saldo', () => {
  it('saldo inicial + receitas − despesas da conta, sem desfeitos, de todas as datas', async () => {
    const principal = await cc.doCliente('c1').favorita()
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 10000 })
    const nubank = r.ok ? r.conta : null
    await lancar('c1', nubank!.id, 'receita', 5000)
    await lancar('c1', nubank!.id, 'despesa', 2000)
    await lancar('c1', nubank!.id, 'despesa', 999, true) // desfeito: não conta
    await lancar('c1', principal.id, 'despesa', 300)
    const lista = await cc.listar('c1')
    expect(lista.find((c) => c.apelido === 'nubank')!.saldo).toBe(13000)
    expect(lista.find((c) => c.apelido === 'principal')!.saldo).toBe(-300)
  })
})

describe('editar', () => {
  it('muda nome e saldo inicial, nunca o apelido, e só do próprio cliente', async () => {
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = r.ok ? r.conta.id : ''
    expect(await cc.editar('c1', id, { nome: 'Nu Conta', saldoInicial: -5000 })).toBe('ok')
    expect(await cc.doCliente('c1').porApelido('nubank')).toMatchObject({ nome: 'Nu Conta', saldoInicial: -5000 })
    expect(await cc.editar('c1', id, { nome: '  ', saldoInicial: 0 })).toBe('nome_invalido')
    expect(await cc.editar('c2', id, { nome: 'Invasor', saldoInicial: 0 })).toBe('nao_encontrada')
    expect(await cc.doCliente('c1').porApelido('nubank')).toMatchObject({ nome: 'Nu Conta' })
  })
})

describe('favoritar e desativar', () => {
  it('favoritar troca a favorita na mesma operação; sempre uma só', async () => {
    const principal = await cc.doCliente('c1').favorita()
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const nubank = r.ok ? r.conta : null
    expect(await cc.favoritar('c1', nubank!.id)).toBe('ok')
    expect((await cc.doCliente('c1').favorita()).id).toBe(nubank!.id)
    expect((await cc.listar('c1')).filter((c) => c.favorita)).toHaveLength(1)
    expect(await cc.doCliente('c1').porApelido('principal')).toMatchObject({ id: principal.id, favorita: false })
  })

  it('não favorita conta desativada nem conta de outro cliente', async () => {
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = r.ok ? r.conta.id : ''
    await cc.definirAtiva('c1', id, false)
    expect(await cc.favoritar('c1', id)).toBe('inativa')
    expect(await cc.favoritar('c2', id)).toBe('nao_encontrada')
  })

  it('não desativa a favorita; desativa e reativa as outras', async () => {
    const principal = await cc.doCliente('c1').favorita()
    expect(await cc.definirAtiva('c1', principal.id, false)).toBe('favorita')
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = r.ok ? r.conta.id : ''
    expect(await cc.definirAtiva('c1', id, false)).toBe('ok')
    expect(await cc.definirAtiva('c1', id, true)).toBe('ok')
    expect(await cc.definirAtiva('c2', id, false)).toBe('nao_encontrada')
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run tests/contasCorrentes.test.ts`
Expected: FAIL (`Cannot find module '../src/contasCorrentes'`).

- [ ] **Step 5: Implementar `src/contasCorrentes.ts`**

```ts
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
              COALESCE(SUM(CASE WHEN l.tipo = 'receita' THEN l.valor ELSE -l.valor END), 0)::bigint AS movimento
       FROM contas_correntes c
       LEFT JOIN lancamentos l ON l.conta_corrente_id = c.id AND l.desfeito_em IS NULL
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

    // ponytail: troca a favorita numa transação (o índice parcial único não deixa duas ao mesmo tempo); sem retry em caso de corrida
    async favoritar(contaId: string, id: string): Promise<'ok' | 'nao_encontrada' | 'inativa'> {
      const c = await pool.connect()
      try {
        await c.query('BEGIN')
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
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/contasCorrentes.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 7: Suíte e typecheck**

Run: `npm run typecheck && npm test`
Expected: tudo verde (nenhum código existente mudou além da coluna nova).

- [ ] **Step 8: Commit**

```bash
git add src/contasCorrentes.ts src/types.ts src/repo.ts tests/contasCorrentes.test.ts
git commit -m "feat: contas correntes (cadastro, favorita, saldo e migração)"
```

---

### Task 2: Lançamentos apontam para uma conta corrente (encanamento)

Nenhum comportamento novo para o usuário: o `Service` passa a gravar cada lançamento na conta favorita, e o `Repo` aprende a filtrar por conta corrente. Sem `@`, nada muda nas mensagens.

**Files:**
- Modify: `src/types.ts:4-16`
- Modify: `src/repo.ts`
- Modify: `src/service.ts:16-24, 44-59`
- Modify: `src/index.ts:9-12, 24-26, 38`
- Modify: `tests/memoryRepo.ts`
- Create: `tests/memoryContasCorrentes.ts`
- Modify: `tests/repo.contract.ts`, `tests/pgRepo.test.ts`, `tests/service.test.ts`

**Interfaces:**
- Consumes: `ContasDoCliente` (Task 1).
- Produces:
  - `NovoLancamento` ganha `contaCorrenteId: string`; `Lancamento` herda.
  - `Repo.extrato(intervalo, contaCorrenteId?)`, `Repo.balancete(intervalo, contaCorrenteId?)`, `Repo.serieMensal(ate, meses, contaCorrenteId?)`.
  - `new Service(repo: Repo, contasCC: ContasDoCliente, agora = () => new Date(), auditor?: Auditor)` (a porta entra como 2º parâmetro).
  - `tests/memoryContasCorrentes.ts`: `contasEmMemoria(lista?: ContaCorrenteComSaldo[]): ContasDoCliente`, e a constante `PRINCIPAL: ContaCorrenteComSaldo` (id `cc1`, apelido `principal`, nome `Principal`, favorita, ativa, saldo 0).

- [ ] **Step 1: Atualizar o contrato do repo (teste primeiro)** — em `tests/repo.contract.ts`:

Na função `novo`, acrescente o campo padrão:

```ts
const novo = (o: Partial<NovoLancamento> = {}): NovoLancamento => ({
  tipo: 'despesa',
  conta: 'mercado',
  valor: 1000,
  remetente: 'u@s.whatsapp.net',
  msgId: `m${++n}`,
  data: new Date('2026-09-10T12:00:00Z'),
  enviadoEm: new Date('2026-09-10T12:00:00Z'),
  contaCorrenteId: 'cc1',
  ...o,
})
```

E dentro de `describe(`Repo (${nome})`, ...)`, antes do `})` final do `describe`, acrescente:

```ts
    it('filtra por conta corrente em extrato, balancete e serieMensal; sem filtro soma todas', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'mercado', valor: 1000, contaCorrenteId: 'cc1' }))
      await repo.add(novo({ conta: 'luz', valor: 300, contaCorrenteId: 'cc2' }))
      const mes = { de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') }
      expect((await repo.extrato(mes, 'cc2')).map((l) => l.conta)).toEqual(['luz'])
      expect((await repo.extrato(mes)).map((l) => l.conta)).toEqual(['mercado', 'luz'])
      expect((await repo.balancete(null, 'cc1')).despesas).toEqual([{ conta: 'mercado', total: 1000 }])
      expect((await repo.balancete(null)).despesas).toHaveLength(2)
      expect(await repo.serieMensal(new Date('2026-09-30T12:00:00Z'), 1, 'cc2')).toEqual([{ ano: 2026, mes: 9, receitas: 0, despesas: 300 }])
      expect(await repo.serieMensal(new Date('2026-09-30T12:00:00Z'), 1)).toEqual([{ ano: 2026, mes: 9, receitas: 0, despesas: 1300 }])
    })

    it('o lançamento guarda a conta corrente', async () => {
      const repo = await criar()
      await repo.add(novo({ contaCorrenteId: 'cc9' }))
      const [l] = await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })
      expect(l.contaCorrenteId).toBe('cc9')
    })
```

- [ ] **Step 2: Atualizar os lançamentos literais de `tests/pgRepo.test.ts`** — nos três literais (linhas 35, 43 e 55) acrescente `contaCorrenteId: 'cc1'` ao objeto, por exemplo:

```ts
const l = { tipo: 'despesa' as const, conta: 'x', valor: 100, remetente: 'u', msgId: 'm1', data: new Date(), enviadoEm: new Date(), contaCorrenteId: 'cc1' }
```

e, no terceiro, `const l = (msgId: string, valor: number) => ({ ..., enviadoEm: new Date(), contaCorrenteId: 'cc1' })`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/memoryRepo.test.ts tests/pgRepo.test.ts`
Expected: FAIL (o filtro e o campo ainda não existem).

- [ ] **Step 4: `src/types.ts`** — substituir as linhas 4–16 por:

```ts
export type NovoLancamento = { tipo: Natureza; conta: string; valor: number; remetente: string; msgId: string; data: Date; enviadoEm: Date; contaCorrenteId: string }
export type Lancamento = NovoLancamento & { desfeitoEm: Date | null }
export type Intervalo = { de: Date; ate: Date } | null   // null = tudo; `ate` é exclusivo
export type LinhaConta = { conta: string; total: number }
export type Balancete = { receitas: LinhaConta[]; despesas: LinhaConta[] } // cada lista em ordem decrescente de total
export type MesSerie = { ano: number; mes: number; receitas: number; despesas: number }
// `contaCorrenteId` opcional em extrato/balancete/serieMensal: sem ele, somam todas as contas correntes do cliente
export interface Repo {
  add(l: NovoLancamento): Promise<'ok' | 'duplicado'>
  desfazerUltimo(): Promise<Lancamento | null> // último por enviadoEm (desempate: inserção), ignora já desfeitos
  extrato(intervalo: { de: Date; ate: Date }, contaCorrenteId?: string): Promise<Lancamento[]> // sem desfeitos, data em [de, ate), ordem: data, enviadoEm, inserção
  balancete(intervalo: Intervalo, contaCorrenteId?: string): Promise<Balancete> // ignora desfeitos
  serieMensal(ate: Date, meses: number, contaCorrenteId?: string): Promise<MesSerie[]> // `meses` meses consecutivos terminando no mês local de `ate`, do mais antigo ao mais novo; meses sem lançamento vêm com 0; ignora desfeitos
}
```

(Mantenha a linha 1–3 e a linha `export type Leitura = ...` como estão; os tipos `ContaCorrente`, `ContaCorrenteComSaldo` e `ContasDoCliente` da Task 1 continuam no fim do arquivo.)

- [ ] **Step 5: `src/repo.ts`** — aplicar estas mudanças:

`Row` ganha `conta_corrente_id: string` e `paraLancamento` ganha `contaCorrenteId: r.conta_corrente_id`:

```ts
type Row = {
  tipo: Natureza
  conta: string
  valor: string // bigint volta como string no pg
  remetente: string
  msg_id: string
  data: Date
  enviado_em: Date
  desfeito_em: Date | null
  conta_corrente_id: string
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
})
```

`add`:

```ts
      await this.pool.query(
        'INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em, conta_corrente_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [this.contaId, l.tipo, l.conta, l.valor, l.remetente, l.msgId, l.data, l.enviadoEm, l.contaCorrenteId],
      )
```

`desfazerUltimo`: no `RETURNING` acrescente `l.conta_corrente_id`:

```ts
       RETURNING l.tipo, l.conta, l.valor, l.remetente, l.msg_id, l.data, l.enviado_em, l.desfeito_em, l.conta_corrente_id`,
```

`extrato`:

```ts
  async extrato(intervalo: { de: Date; ate: Date }, contaCorrenteId?: string) {
    const r = await this.pool.query<Row>(
      `SELECT tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em, conta_corrente_id FROM lancamentos
       WHERE conta_id = $1 AND desfeito_em IS NULL AND data >= $2 AND data < $3 AND ($4::text IS NULL OR conta_corrente_id = $4)
       ORDER BY data ASC, enviado_em ASC, id ASC`,
      [this.contaId, intervalo.de, intervalo.ate, contaCorrenteId ?? null],
    )
    return r.rows.map(paraLancamento)
  }
```

`balancete`:

```ts
  async balancete(intervalo: Intervalo, contaCorrenteId?: string): Promise<Balancete> {
    const r = await this.pool.query<{ tipo: Natureza; conta: string; total: string }>(
      `SELECT tipo, conta, SUM(valor)::bigint AS total FROM lancamentos
       WHERE ($1::text IS NULL OR conta_id = $1) AND desfeito_em IS NULL
         AND ($2::timestamptz IS NULL OR data >= $2)
         AND ($3::timestamptz IS NULL OR data < $3)
         AND ($4::text IS NULL OR conta_corrente_id = $4)
       GROUP BY tipo, conta
       ORDER BY total DESC, conta ASC`,
      [this.contaId, intervalo?.de ?? null, intervalo?.ate ?? null, contaCorrenteId ?? null],
    )
```

`serieMensal`: assinatura `(ate: Date, meses: number, contaCorrenteId?: string)`, a subquery vira

```ts
         SELECT tipo, valor, (data AT TIME ZONE 'UTC') - interval '3 hours' AS loc FROM lancamentos
         WHERE ($1::text IS NULL OR conta_id = $1) AND desfeito_em IS NULL AND data >= $2 AND data < $3
           AND ($4::text IS NULL OR conta_corrente_id = $4)
```

e os parâmetros `[this.contaId, intervaloDoMes(primeiro.ano, primeiro.mes).de, intervaloDoMes(ultimo.ano, ultimo.mes).ate, contaCorrenteId ?? null]`.

- [ ] **Step 6: `tests/memoryRepo.ts`** — substituir `extrato`, `serieMensal` e `balancete` por versões com filtro (o resto da classe fica igual):

```ts
  async extrato(intervalo: { de: Date; ate: Date }, contaCorrenteId?: string) {
    return this.itens
      .map((item, ordem) => ({ item, ordem }))
      .filter((x) => !x.item.desfeitoEm && x.item.data.getTime() >= intervalo.de.getTime() && x.item.data.getTime() < intervalo.ate.getTime() && (!contaCorrenteId || x.item.contaCorrenteId === contaCorrenteId))
      .sort((a, b) => a.item.data.getTime() - b.item.data.getTime() || a.item.enviadoEm.getTime() - b.item.enviadoEm.getTime() || a.ordem - b.ordem)
      .map((x) => ({ ...x.item }))
  }

  async serieMensal(ate: Date, meses: number, contaCorrenteId?: string): Promise<MesSerie[]> {
    return mesesTerminandoEm(ate, meses).map(({ ano, mes }) => {
      const { de, ate: fim } = intervaloDoMes(ano, mes)
      const soma = (t: Natureza) =>
        this.itens
          .filter((i) => !i.desfeitoEm && i.tipo === t && i.data.getTime() >= de.getTime() && i.data.getTime() < fim.getTime() && (!contaCorrenteId || i.contaCorrenteId === contaCorrenteId))
          .reduce((s, i) => s + i.valor, 0)
      return { ano, mes, receitas: soma('receita'), despesas: soma('despesa') }
    })
  }

  async balancete(intervalo: Intervalo, contaCorrenteId?: string): Promise<Balancete> {
    const somas = { receita: new Map<string, number>(), despesa: new Map<string, number>() }
    for (const i of this.itens) {
      if (i.desfeitoEm) continue
      if (contaCorrenteId && i.contaCorrenteId !== contaCorrenteId) continue
      if (intervalo && (i.data.getTime() < intervalo.de.getTime() || i.data.getTime() >= intervalo.ate.getTime())) continue
      const m = somas[i.tipo]
      m.set(i.conta, (m.get(i.conta) ?? 0) + i.valor)
    }
    const linhas = (m: Map<string, number>): LinhaConta[] =>
      [...m].map(([conta, total]) => ({ conta, total })).sort((a, b) => b.total - a.total)
    return { receitas: linhas(somas.receita), despesas: linhas(somas.despesa) }
  }
```

- [ ] **Step 7: Criar `tests/memoryContasCorrentes.ts`**

```ts
import type { ContaCorrenteComSaldo, ContasDoCliente } from '../src/types'

export const PRINCIPAL: ContaCorrenteComSaldo = { id: 'cc1', apelido: 'principal', nome: 'Principal', saldoInicial: 0, saldo: 0, favorita: true, ativa: true }

// ContasDoCliente em memória para os testes do Service; o cálculo de saldo é testado em contasCorrentes.test.ts (Postgres)
export function contasEmMemoria(lista: ContaCorrenteComSaldo[] = [PRINCIPAL]): ContasDoCliente {
  const semSaldo = ({ saldo: _saldo, ...c }: ContaCorrenteComSaldo) => c
  return {
    favorita: async () => semSaldo(lista.find((c) => c.favorita)!),
    porApelido: async (apelido) => {
      const c = lista.find((x) => x.apelido === apelido)
      return c ? semSaldo(c) : null
    },
    ativas: async () => lista.filter((c) => c.ativa),
  }
}
```

- [ ] **Step 8: `src/service.ts`** — imports e construtor:

```ts
import type { ContasDoCliente, Lancamento, LinhaConta, Natureza, Repo } from './types'
```

```ts
  constructor(
    private repo: Repo,
    private contasCC: ContasDoCliente,
    private agora: () => Date = () => new Date(),
    private auditor?: Auditor,
  ) {}
```

No `case 'lancamento'`, resolva a favorita e grave com ela:

```ts
      case 'lancamento': {
        // sem data informada pelo usuário, vale a data de envio da mensagem
        const data = cmd.data ? resolverData(cmd.data, msg.enviadoEm) : msg.enviadoEm
        if (!data) return { texto: ui.ERRO_DATA, lancou: false }
        const contaCorrente = await this.contasCC.favorita()
        const r = await this.repo.add({
          tipo: cmd.natureza,
          conta: cmd.conta,
          valor: cmd.valor,
          remetente: msg.remetente,
          msgId: msg.msgId,
          data,
          enviadoEm: msg.enviadoEm,
          contaCorrenteId: contaCorrente.id,
        })
```

(o `if (r === 'duplicado') return null` e o `return` seguintes ficam iguais.)

- [ ] **Step 9: `src/index.ts`** — importar e injetar:

```ts
import { criarContasCorrentes } from './contasCorrentes'
```

Depois de `const repo = await criarRepo(banco.pool)`:

```ts
const contasCorrentes = await criarContasCorrentes(banco.pool) // depois de criarRepo: a migração lê `lancamentos`
```

e a linha do `criarService`:

```ts
  criarService: (id) => new Service(repo.repoDe(id), contasCorrentes.doCliente(id), undefined, auditor),
```

- [ ] **Step 10: `tests/service.test.ts`** — importar e atualizar os 8 pontos de construção:

Imports (junto dos demais):

```ts
import { contasEmMemoria } from './memoryContasCorrentes'
```

Linhas a trocar:
- 18: `const novoService = () => new Service(new MemoryRepo(), contasEmMemoria(), agora)`
- 126: `const s = new Service(new MemoryRepo(), contasEmMemoria(), () => new Date('2026-01-10T12:00:00Z'))`
- 201: `const antes = new Service(new MemoryRepo(), contasEmMemoria(), () => new Date('2026-09-15T02:59:00Z'))`
- 204: `const depois = new Service(new MemoryRepo(), contasEmMemoria(), () => new Date('2026-09-15T03:00:00Z'))`
- 283: `const novo = (auditor?: Auditor) => new Service(new MemoryRepo(), contasEmMemoria(), agora, auditor)`
- 444: `const s = new Service(repo, contasEmMemoria(), agora, auditorFalso(['Corte *tudo* _já_ ~agora~ `ok`']))`
- 614: `const s = new Service(quebrado, contasEmMemoria(), agora)`
- 623: `const s = new Service({ ...quebrado, add }, contasEmMemoria(), agora)`

Acrescente ainda, em `describe('Service: lançamentos', ...)`, o teste que prova a gravação na favorita:

```ts
  it('grava o lançamento na conta corrente favorita', async () => {
    const repo = new MemoryRepo()
    await new Service(repo, contasEmMemoria(), agora).handle(msg('/d mercado 45,90'))
    const [l] = await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })
    expect(l.contaCorrenteId).toBe('cc1')
  })
```

- [ ] **Step 11: Rodar tudo**

Run: `npm run typecheck && npm test`
Expected: tudo verde. Se algum teste fora desta lista montar `new Service(...)` ou um `NovoLancamento` literal, o typecheck aponta; corrija do mesmo jeito (porta `contasEmMemoria()` em 2º lugar; `contaCorrenteId: 'cc1'` no literal).

- [ ] **Step 12: Commit**

```bash
git add src tests
git commit -m "feat: lançamentos gravados na conta corrente favorita e filtro no Repo"
```

---

### Task 3: Parser: `@apelido`, `/contas` e filtros

**Files:**
- Modify: `src/parser.ts`
- Modify: `tests/parser.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces (usado pela Task 4): `Comando` passa a ter
  - `{ tipo: 'lancamento'; natureza; conta; valor; data?; contaCorrente?: string }`
  - `{ tipo: 'balancete'; relatorio: 'hoje' | Relatorio; contaCorrente?: string }`
  - `{ tipo: 'extrato'; pagina: number; contaCorrente?: string }`
  - `{ tipo: 'contas' }`
  - `contaCorrente` é o apelido sem o `@`, minúsculo; a chave só existe quando o usuário digitou `@`.

- [ ] **Step 1: Escrever os testes que falham** — acrescentar ao fim de `tests/parser.test.ts`:

```ts
describe('parse: conta corrente (@apelido)', () => {
  it.each([
    ['/d mercado 45,90 @nubank', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
    ['/d @nubank mercado 45,90', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
    ['/d mercado @nubank 45,90', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
    ['/r plantão 70 @itau-pj', { ...rec('plantão', 7000), contaCorrente: 'itau-pj' }],
    ['/d mercado 45,90 @NuBank', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
  ])('lançamento com conta: %j', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('@ convive com a data, antes ou depois dela', () => {
    expect(parse('/d mercado 45 ontem @nubank')).toEqual({ ...desp('mercado', 4500), data: { tipo: 'relativa', diasAtras: 1 }, contaCorrente: 'nubank' })
    expect(parse('/d mercado 45 @nubank ontem')).toEqual({ ...desp('mercado', 4500), data: { tipo: 'relativa', diasAtras: 1 }, contaCorrente: 'nubank' })
  })

  it('sem @, o resultado é o de antes (sem a chave contaCorrente)', () => {
    expect(parse('/d mercado 45,90')).toEqual(desp('mercado', 4590))
  })

  it.each([['/d mercado 45 @a @b'], ['/d mercado 45 @'], ['/d mercado 45 @com.ponto'], ['/d mercado 45 @' + 'a'.repeat(21)], ['/d mercado @nubank'], ['/d @nubank 45']])(
    'uso incorreto: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'despesa' })
    },
  )

  it.each([
    ['/b @nubank', { tipo: 'balancete', relatorio: 'hoje', contaCorrente: 'nubank' }],
    ['/b mensal @nubank', { tipo: 'balancete', relatorio: 'mensal', contaCorrente: 'nubank' }],
    ['/b @nubank anual', { tipo: 'balancete', relatorio: 'anual', contaCorrente: 'nubank' }],
    ['/e @nubank', { tipo: 'extrato', pagina: 1, contaCorrente: 'nubank' }],
    ['/e 2 @nubank', { tipo: 'extrato', pagina: 2, contaCorrente: 'nubank' }],
    ['/extrato @nubank 3', { tipo: 'extrato', pagina: 3, contaCorrente: 'nubank' }],
  ])('filtro por conta: %j', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('filtro inválido ou duplicado devolve a dica do comando; auditoria não aceita @', () => {
    expect(parse('/b @a @b')).toEqual({ tipo: 'uso', comando: 'balancete' })
    expect(parse('/e @')).toEqual({ tipo: 'uso', comando: 'extrato' })
    expect(parse('/a @nubank')).toEqual({ tipo: 'uso', comando: 'auditoria' })
  })
})

describe('parse: /contas', () => {
  it.each([['/contas'], ['/c'], ['  /Contas  ']])('%j', (entrada) => {
    expect(parse(entrada)).toEqual({ tipo: 'contas' })
  })
  it('com argumento não é comando', () => {
    expect(parse('/contas x')).toBeNull()
    expect(parse('/c @nubank')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL nos testes novos.

- [ ] **Step 3: Implementar em `src/parser.ts`**

Tipo `Comando` (linhas 6–13) vira:

```ts
export type Comando =
  | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc; contaCorrente?: string }
  | { tipo: 'balancete'; relatorio: 'hoje' | Relatorio; contaCorrente?: string } // 'hoje' = extrato do dia
  | { tipo: 'auditoria'; relatorio: Relatorio }
  | { tipo: 'extrato'; pagina: number; contaCorrente?: string } // extrato completo da conta, paginado
  | { tipo: 'contas' } // lista as contas correntes
  | { tipo: 'uso'; comando: 'balancete' | 'auditoria' | 'extrato' | 'despesa' | 'receita' } // uso incorreto: o service responde a dica
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }
```

`Nome` e `COMANDOS` ganham `contas`:

```ts
type Nome = 'despesa' | 'receita' | 'balancete' | 'extrato' | 'auditoria' | 'desfazer' | 'ajuda' | 'contas'
const COMANDOS = new Map<string, Nome>([
  ['d', 'despesa'], ['despesa', 'despesa'], ['r', 'receita'], ['receita', 'receita'],
  ['b', 'balancete'], ['balancete', 'balancete'], ['e', 'extrato'], ['extrato', 'extrato'],
  ['a', 'auditoria'], ['auditoria', 'auditoria'], ['desfazer', 'desfazer'], ['h', 'ajuda'], ['ajuda', 'ajuda'],
  ['c', 'contas'], ['contas', 'contas'],
])
```

Constante nova perto de `DIA_MES`:

```ts
const APELIDO = /^@([a-z0-9_-]{1,20})$/ // a mensagem já chega minúscula
```

Em `parse`, troque o trecho que vai de `const resto = args.join(' ')` até o fim da função por:

```ts
  if (nome === 'ajuda' || nome === 'desfazer' || nome === 'contas') return args.length ? null : { tipo: nome }

  // "@apelido" (a conta corrente) vale em qualquer posição; no máximo um, e no formato certo
  const marcas = args.filter((a) => a.startsWith('@'))
  const palavras = args.filter((a) => !a.startsWith('@'))
  const apelido = marcas.length === 1 ? APELIDO.exec(marcas[0])?.[1] : undefined
  const marcaInvalida = marcas.length > 1 || (marcas.length === 1 && !apelido)
  const cc = apelido ? { contaCorrente: apelido } : {}
  const resto = palavras.join(' ')

  if (nome === 'extrato') {
    const pagina = resto || '1'
    return !marcaInvalida && /^\d{1,6}$/.test(pagina) && Number(pagina) >= 1 ? { tipo: 'extrato', pagina: Number(pagina), ...cc } : { tipo: 'uso', comando: 'extrato' }
  }

  if (nome === 'balancete' || nome === 'auditoria') {
    if (nome === 'auditoria' && marcas.length) return { tipo: 'uso', comando: nome } // a auditoria é sempre consolidada
    const relatorio = resto || (nome === 'balancete' ? 'hoje' : 'mensal')
    const valido = relatorio === 'mensal' || relatorio === 'semanal' || relatorio === 'anual' || (relatorio === 'hoje' && nome === 'balancete')
    if (!valido || marcaInvalida) return { tipo: 'uso', comando: nome }
    return nome === 'balancete' ? { tipo: 'balancete', relatorio, ...cc } : { tipo: 'auditoria', relatorio: relatorio as Relatorio }
  }

  // "/d conta valor [data] [@conta]": data opcional no fim ("ontem", "15/09", "15/09/2026"); sem ela, o service usa a data de envio
  const data = palavras.length ? lerData(palavras[palavras.length - 1]) : null
  const itens = data ? palavras.slice(0, -1) : palavras
  const valor = itens.length >= 2 ? parseValor(itens[itens.length - 1]) : null
  const conta = itens.slice(0, -1).join(' ')
  if (marcaInvalida || valor === null || conta.length > MAX_CONTA || !/^\p{L}/u.test(conta)) return { tipo: 'uso', comando: nome }

  return { tipo: 'lancamento', natureza: nome, conta, valor, ...(data && { data }), ...cc }
}
```

Atenção: o `if (nome === 'ajuda' || nome === 'desfazer') return resto ? null : ...` antigo e a linha `const resto = args.join(' ')` somem (substituídos acima); o bloco antigo de `extrato`, `balancete/auditoria` e lançamento também.

- [ ] **Step 4: Rodar**

Run: `npx vitest run tests/parser.test.ts && npm run typecheck`
Expected: PASS. (O `typecheck` pode apontar `case` não coberto em `service.ts` para `'contas'`: o `switch` de `executar` não é exaustivo por retorno, então tipicamente passa; se acusar, a Task 4 cobre; neste caso adicione temporariamente `case 'contas': return null` e remova na Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/parser.ts tests/parser.test.ts
git commit -m "feat: parser com @apelido, /contas e filtros por conta"
```

---

### Task 4: Service e mensagens: `@conta`, confirmação com nome, `/contas` e filtros

**Files:**
- Modify: `src/presentation.ts`
- Modify: `src/service.ts`
- Modify: `tests/service.test.ts`, `tests/presentation.test.ts` (somente se algum texto de ajuda/uso for comparado literalmente; veja o Step 7)

**Interfaces:**
- Consumes: `Comando` com `contaCorrente?`, `{ tipo: 'contas' }` (Task 3); `ContasDoCliente` (Tasks 1–2); `contasEmMemoria`/`PRINCIPAL` (Task 2).
- Produces: nada para outras tasks.

- [ ] **Step 1: Testes que falham** — acrescentar em `tests/service.test.ts` (importar `PRINCIPAL` junto de `contasEmMemoria`: `import { contasEmMemoria, PRINCIPAL } from './memoryContasCorrentes'`; e `type ContaCorrenteComSaldo` de `../src/types`):

```ts
const NUBANK: ContaCorrenteComSaldo = { id: 'cc2', apelido: 'nubank', nome: 'Nubank', saldoInicial: 0, saldo: 150000, favorita: false, ativa: true }
const ANTIGA: ContaCorrenteComSaldo = { id: 'cc3', apelido: 'antiga', nome: 'Antiga', saldoInicial: 0, saldo: 0, favorita: false, ativa: false }
const comDuasContas = (repo = new MemoryRepo()) => new Service(repo, contasEmMemoria([PRINCIPAL, NUBANK, ANTIGA]), agora)
const mes = { de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') }

describe('Service: contas correntes', () => {
  it('sem @ vai para a favorita; com @ vai para a outra', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    await s.handle(msg('/d mercado 10'))
    await s.handle(msg('/d farmácia 20 @nubank'))
    const itens = await repo.extrato(mes)
    expect(itens.map((l) => [l.conta, l.contaCorrenteId])).toEqual([['mercado', 'cc1'], ['farmácia', 'cc2']])
  })

  it('a confirmação mostra o nome da conta só com 2+ contas ativas', async () => {
    const r2 = await comDuasContas().handle(msg('/d farmácia 20 @nubank'))
    expect(r2?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _farmácia_\n💰 *R$ 20,00*\n🏦 _Nubank_')
    const r1 = await novoService().handle(msg('/d mercado 45,90'))
    expect(r1?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 45,90*')
  })

  it('@ desconhecido ou desativada: não grava e lista as contas ativas', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    for (const texto of ['/d mercado 10 @nada', '/d mercado 10 @antiga']) {
      const r = await s.handle(msg(texto))
      expect(r?.lancou).toBe(false)
      expect(r?.texto).toContain('CONTA NÃO ENCONTRADA')
      expect(r?.texto).toContain('Nenhum lançamento foi registrado')
      expect(r?.texto).toContain('@principal')
      expect(r?.texto).toContain('@nubank')
      expect(r?.texto).not.toContain('@antiga ·')
    }
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('descrição com @ no meio vira conta: se não existir, nada é gravado', async () => {
    const repo = new MemoryRepo()
    const r = await comDuasContas(repo).handle(msg('/d pix @joao 50'))
    expect(r?.lancou).toBe(false)
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('/contas lista as ativas com saldo e marca a favorita', async () => {
    const r = await comDuasContas().handle(msg('/contas'))
    expect(r).toEqual({
      lancou: false,
      texto: secoes('🏦 *CONTAS CORRENTES*', '⭐ *Principal*\n`@principal`\n💰 *R$ 0,00*', '*Nubank*\n`@nubank`\n💰 *R$ 1.500,00*'),
    })
  })

  it('/b e /e com @ filtram pela conta e dizem qual; sem @ somam todas', async () => {
    const s = comDuasContas()
    const hoje = '2026-09-15T12:00:00Z' // o `agora` do Service: o /b do dia só mostra lançamentos de hoje
    await s.handle(msg('/d mercado 10', hoje))
    await s.handle(msg('/d farmácia 20 @nubank', hoje))
    const nu = (await s.handle(msg('/b @nubank')))?.texto ?? ''
    expect(nu).toContain('farmácia')
    expect(nu).not.toContain('mercado')
    expect(nu).toContain('Nubank')
    const ex = (await s.handle(msg('/e @nubank')))?.texto ?? ''
    expect(ex).toContain('farmácia')
    expect(ex).not.toContain('mercado')
    const todos = (await s.handle(msg('/b')))?.texto ?? ''
    expect(todos).toContain('farmácia')
    expect(todos).toContain('mercado')
    expect((await s.handle(msg('/b mensal @nubank')))?.texto).toContain('R$ 20,00')
  })

  it('filtro por @ inexistente responde conta não encontrada; desativada ainda filtra', async () => {
    const s = comDuasContas()
    expect((await s.handle(msg('/b @nada')))?.texto).toContain('CONTA NÃO ENCONTRADA')
    expect((await s.handle(msg('/b @nada')))?.texto).not.toContain('Nenhum lançamento foi registrado')
    expect((await s.handle(msg('/e @antiga')))?.texto).toContain('Nenhum lançamento')
    expect((await s.handle(msg('/e @antiga')))?.texto).not.toContain('CONTA NÃO ENCONTRADA')
  })

  it('/contas e filtros não rodam em mensagens recuperadas', async () => {
    expect(await comDuasContas().handle(msg('/contas'), { recuperada: true })).toBeNull()
  })

  it('/ajuda cita @conta e /contas', async () => {
    const t = (await novoService().handle(msg('/ajuda')))?.texto ?? ''
    expect(t).toContain('@conta')
    expect(t).toContain('/contas')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/service.test.ts`
Expected: FAIL nos novos.

- [ ] **Step 3: `src/presentation.ts`** — mudanças:

Import do tipo:

```ts
import type { ContaCorrenteComSaldo, Lancamento, Natureza } from './types'
```

`lancamentoRegistrado` ganha a linha da conta (opcional):

```ts
export function lancamentoRegistrado(l: { natureza: Natureza; conta: string; valor: number; dia?: Date; contaCorrente?: string }): string {
  const linhas = [`📝 ${italic(limpar(l.conta))}`, `💰 ${bold(formatBRL(l.valor))}`, ...(l.dia ? [`📅 ${italic(rotuloDia(l.dia))}`] : []), ...(l.contaCorrente ? [`🏦 ${italic(limpar(l.contaCorrente))}`] : [])]
  return `${cabecalho(icone(l.natureza), l.natureza === 'receita' ? 'RECEITA REGISTRADA' : 'DESPESA REGISTRADA')}\n\n${linhas.join('\n')}`
}
```

Os relatórios dizem a conta quando filtrados (parâmetro opcional `filtro`, o nome da conta):

```ts
const comFiltro = (sub: string | undefined, filtro?: string) => (filtro ? [sub, limpar(filtro)].filter(Boolean).join(' · ') : sub)

export function balanceteDoDia(agora: Date, itens: Lancamento[], receitas: number, despesas: number, filtro?: string): string {
  const cab = cabecalho('📊', 'BALANCETE DO DIA', comFiltro(dataCompleta(agora), filtro))
  if (!itens.length) return `${cab}\n\n${italic('Nenhum lançamento registrado hoje.')}`
  const linhas = itens.map((l) => `🕐 ${bold(rotuloHora(l.enviadoEm))}\n${icone(l.tipo)} ${limpar(l.conta)}\n${sinal(l.tipo, l.valor)}`)
  return secoes(cab, linhas.join('\n\n'), totais(receitas, despesas))
}

export function resumoPeriodos(rel: string, blocos: BlocoPeriodo[], filtro?: string): string {
  const cab = cabecalho('📊', `BALANCETE ${rel.toUpperCase()}`, comFiltro(undefined, filtro))
  if (!blocos.length) return `${cab}\n\n${italic('Nenhum lançamento no período.')}`
  return secoes(cab, ...blocos.map((b) => `📅 ${bold(rotuloBonito(b.rotulo))}\n\n${totais(b.receitas, b.despesas)}`))
}
```

`extrato` e `extratoVazio` (o rodapé "Digite /extrato 2" fica como está; o usuário reaplica o `@`):

```ts
export function extrato(pagina: number, total: number, itens: Lancamento[], geral: { receitas: number; despesas: number } | null, filtro?: string): string {
  const linhas = itens
    .map((l) => `📅 ${bold(`${rotuloDia(l.data)} · ${rotuloHora(l.enviadoEm)}`)}\n${icone(l.tipo)} ${italic(limpar(l.conta))}\n${sinal(l.tipo, l.valor)}`)
    .join('\n\n')
  const rodape = pagina < total ? `➡️ ${italic(`Digite ${bold(`/extrato ${pagina + 1}`)} para continuar.`)}` : total > 1 ? `✅ ${italic('Fim do extrato.')}` : ''
  return secoes(
    cabecalho('📒', 'EXTRATO', comFiltro(`Página ${pagina} de ${total}`, filtro)),
    ...(geral ? [totais(geral.receitas, geral.despesas)] : []),
    linhas,
    ...(rodape ? [rodape] : []),
  )
}

export const extratoVazio = (filtro?: string) => `${cabecalho('📒', 'EXTRATO', comFiltro(undefined, filtro))}\n\n${italic('Nenhum lançamento encontrado.')}`
```

Mensagens novas, antes de `export const ERRO_GENERICO`:

```ts
// `gravando`: o comando era um lançamento (nada foi gravado) ou só um filtro de relatório
export const contaNaoEncontrada = (apelido: string, ativas: ContaCorrenteComSaldo[], gravando: boolean) =>
  `${erro('🏦', 'CONTA NÃO ENCONTRADA', `A conta @${limpar(apelido)} não existe ou está desativada.`, ...(gravando ? ['Nenhum lançamento foi registrado.'] : []))}\n\n${ativas.map((c) => `👉 ${cmd(`@${c.apelido}`)} · ${limpar(c.nome)}`).join('\n')}`

export function contas(lista: ContaCorrenteComSaldo[]): string {
  const itens = lista.map((c) => `${c.favorita ? '⭐ ' : ''}${bold(limpar(c.nome))}\n${cmd(`@${c.apelido}`)}\n💰 ${bold(formatBRL(c.saldo))}`)
  return secoes(cabecalho('🏦', 'CONTAS CORRENTES'), ...itens)
}
```

Na `AJUDA`, no bloco de lançamentos acrescente uma linha depois de `📅 Data opcional...` e um bloco novo antes de `CORREÇÃO`:

```ts
    `📅 Data opcional\n${cmd('/d mercado 45 ontem')}\n${cmd('/d mercado 45 15/09')}`,
    `🏦 Outra conta (a favorita é a padrão)\n${cmd('/d mercado 45 @nubank')}`,
```

```ts
  [`🏦 ${bold('CONTAS')}`, `${cmd('/contas')}\n${italic('contas e saldos')}\n\n${cmd('/balancete @conta')}\n${cmd('/extrato @conta')}\n${italic('relatório de uma conta só')}`].join('\n\n'),
```

E `USO` ganha a dica de `@` nos lançamentos e filtros:

```ts
export const USO = {
  balancete: uso('/balancete', '/balancete mensal', '/balancete semanal', '/balancete anual', '/balancete @conta'),
  auditoria: uso('/auditoria mensal', '/auditoria semanal', '/auditoria anual'),
  extrato: uso('/extrato', '/extrato 2', '/extrato @conta'),
  despesa: uso('/d mercado 45,90', '/d mercado 45,90 ontem', '/d mercado 45,90 15/09', '/d mercado 45,90 @conta'),
  receita: uso('/r plantão 70', '/r plantão 70 ontem', '/r plantão 70 15/09', '/r plantão 70 @conta'),
}
```

- [ ] **Step 4: `src/service.ts`** — mudanças:

Na linha 30 (recuperadas) inclua `contas`:

```ts
    if (opcoes.recuperada && (cmd.tipo === 'balancete' || cmd.tipo === 'auditoria' || cmd.tipo === 'extrato' || cmd.tipo === 'uso' || cmd.tipo === 'ajuda' || cmd.tipo === 'contas')) return null
```

`case 'lancamento'` completo:

```ts
      case 'lancamento': {
        const conta = cmd.contaCorrente ? await this.contasCC.porApelido(cmd.contaCorrente) : await this.contasCC.favorita()
        if (!conta || !conta.ativa) return { texto: ui.contaNaoEncontrada(cmd.contaCorrente ?? '', await this.contasCC.ativas(), true), lancou: false }
        // sem data informada pelo usuário, vale a data de envio da mensagem
        const data = cmd.data ? resolverData(cmd.data, msg.enviadoEm) : msg.enviadoEm
        if (!data) return { texto: ui.ERRO_DATA, lancou: false }
        const r = await this.repo.add({
          tipo: cmd.natureza,
          conta: cmd.conta,
          valor: cmd.valor,
          remetente: msg.remetente,
          msgId: msg.msgId,
          data,
          enviadoEm: msg.enviadoEm,
          contaCorrenteId: conta.id,
        })
        if (r === 'duplicado') return null
        const varias = (await this.contasCC.ativas()).length >= 2 // com uma conta só, a confirmação fica como sempre foi
        return { texto: ui.lancamentoRegistrado({ natureza: cmd.natureza, conta: cmd.conta, valor: cmd.valor, dia: cmd.data ? data : undefined, contaCorrente: varias ? conta.nome : undefined }), lancou: true }
      }
```

`case 'contas'`, `'balancete'` e `'extrato'`:

```ts
      case 'contas':
        return { texto: ui.contas(await this.contasCC.ativas()), lancou: false }
      case 'balancete':
        return { texto: await this.balancete(cmd.relatorio, cmd.contaCorrente), lancou: false }
```

```ts
      case 'extrato':
        return { texto: await this.extratoPagina(cmd.pagina, cmd.contaCorrente), lancou: false }
```

Método auxiliar (junto de `periodos`), que resolve o filtro ou devolve a mensagem de erro:

```ts
  // `@apelido` de um relatório: o id/nome da conta, ou o texto de "não encontrada". Sem `@`, sem filtro. Desativadas ainda filtram.
  private async filtro(apelido?: string): Promise<{ id?: string; nome?: string } | { erro: string }> {
    if (!apelido) return {}
    const c = await this.contasCC.porApelido(apelido)
    if (!c) return { erro: ui.contaNaoEncontrada(apelido, await this.contasCC.ativas(), false) }
    return { id: c.id, nome: c.nome }
  }
```

`balancete`, `balanceteDoDia`, `extratoPagina` ficam:

```ts
  private async balancete(rel: 'hoje' | Relatorio, apelido?: string): Promise<string> {
    const f = await this.filtro(apelido)
    if ('erro' in f) return f.erro
    const agora = this.agora()
    if (rel === 'hoje') return this.balanceteDoDia(agora, f)

    // resumo: um bloco por período da janela (o atual primeiro); os sem movimento não aparecem
    const blocos: ui.BlocoPeriodo[] = []
    for (const { rotulo, intervalo } of this.periodos(rel).janela) {
      const b = await this.repo.balancete(intervalo, f.id)
      if (!b.receitas.length && !b.despesas.length) continue
      blocos.push({ rotulo, receitas: soma(b.receitas), despesas: soma(b.despesas) })
    }
    return ui.resumoPeriodos(rel, blocos, f.nome)
  }

  private async balanceteDoDia(agora: Date, f: { id?: string; nome?: string }): Promise<string> {
    const extrato = await this.repo.extrato(intervaloDoDia(agora), f.id)
    return ui.balanceteDoDia(agora, extrato, somaTipo(extrato, 'receita'), somaTipo(extrato, 'despesa'), f.nome)
  }

  // extrato completo, do mais recente ao mais antigo, POR_PAGINA lançamentos por página; os totais gerais só na página 1
  private async extratoPagina(pagina: number, apelido?: string): Promise<string> {
    const f = await this.filtro(apelido)
    if ('erro' in f) return f.erro
    const todos = (await this.repo.extrato({ de: new Date(0), ate: new Date('2100-01-01T00:00:00Z') }, f.id)).reverse()
    if (!todos.length) return ui.extratoVazio(f.nome)
    const total = Math.ceil(todos.length / POR_PAGINA)
    if (pagina > total) return ui.paginaInexistente(total)
    const itens = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
    return ui.extrato(pagina, total, itens, pagina === 1 ? { receitas: somaTipo(todos, 'receita'), despesas: somaTipo(todos, 'despesa') } : null, f.nome)
  }
```

A `auditoria` não muda.

- [ ] **Step 5: Rodar**

Run: `npx vitest run tests/service.test.ts tests/presentation.test.ts tests/parser.test.ts`
Expected: os novos passam. Falhas em testes antigos de `presentation`/`service` que comparam o texto literal de `AJUDA` ou `USO` precisam do texto novo: ajuste a expectativa para incluir as linhas acrescentadas (é a mudança pedida). Qualquer outra falha é regressão: corrija o código, não o teste.

- [ ] **Step 6: Suíte completa**

Run: `npm run typecheck && npm test`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add src tests
git commit -m "feat: @conta nos lançamentos, /contas e filtros por conta no bot"
```

---

### Task 5: Portal: página `/contas-correntes`

**Files:**
- Modify: `src/money.ts` (acrescentar `parseSaldo`)
- Modify: `src/paginas.ts`
- Modify: `src/web.ts`
- Modify: `src/index.ts` (passar `contasCorrentes` ao `criarWeb`)
- Modify: `tests/money.test.ts`, `tests/web.test.ts`, `tests/paginas.test.ts`

**Interfaces:**
- Consumes: `ContasCorrentes` (Task 1: `listar`, `criar`, `editar`, `favoritar`, `definirAtiva`).
- Produces:
  - `parseSaldo(s: string): number | null` em `money.ts`.
  - `OpcoesWeb.contasCorrentes: ContasCorrentes` (obrigatório).
  - `paginaContasCorrentes(email, admin, contas: ContaCorrenteComSaldo[], mensagem: { erro?: string; ok?: string }, perfil?)`; `ERROS_CC`, `AVISOS_CC`.
  - Rotas: `GET /contas-correntes`; `POST /contas-correntes`, `/contas-correntes/editar`, `/contas-correntes/favoritar`, `/contas-correntes/desativar`, `/contas-correntes/reativar`.

- [ ] **Step 1: Testes de `parseSaldo`** — acrescentar a `tests/money.test.ts` (importar `parseSaldo` de `../src/money`):

```ts
describe('parseSaldo', () => {
  it.each([
    ['', 0], ['  ', 0], ['0', 0], ['0,00', 0], ['-0', 0],
    ['1500', 150000], ['1.234,56', 123456], ['12,5', 1250], ['R$ 10', 1000],
    ['-50', -5000], ['- 50,25', -5025], ['-1.000', -100000],
  ])('%j -> %j', (entrada, esperado) => {
    expect(parseSaldo(entrada)).toBe(esperado)
  })
  it.each([['abc'], ['1,234'], ['--5'], ['5-'], ['1e3']])('%j -> null', (entrada) => {
    expect(parseSaldo(entrada)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**; depois implementar em `src/money.ts` (fim do arquivo):

```ts
// saldo inicial digitado no portal: vazio = 0; aceita sinal "-" (parseValor só aceita positivos)
export function parseSaldo(s: string): number | null {
  const t = s.trim()
  if (t === '') return 0
  const negativo = t.startsWith('-')
  const v = parseValor(negativo ? t.slice(1).trim() : t)
  if (v !== null) return negativo ? -v : v
  return /^-?\s*0+([.,]0{1,2})?$/.test(t) ? 0 : null
}
```

Run: `npx vitest run tests/money.test.ts` → PASS.

- [ ] **Step 3: Testes da página (que falham)** — em `tests/paginas.test.ts`, importar `paginaContasCorrentes` de `../src/paginas` e `ContaCorrenteComSaldo` de `../src/types`, e acrescentar:

```ts
describe('página de contas correntes', () => {
  const lista: ContaCorrenteComSaldo[] = [
    { id: 'a', apelido: 'principal', nome: 'Principal', saldoInicial: 0, saldo: 1500, favorita: true, ativa: true },
    { id: 'b', apelido: 'nubank', nome: '<b>Nubank</b>', saldoInicial: 0, saldo: -300, favorita: false, ativa: true },
    { id: 'c', apelido: 'antiga', nome: 'Antiga', saldoInicial: 0, saldo: 0, favorita: false, ativa: false },
  ]
  const html = paginaContasCorrentes('a@x.com', false, lista, {})

  it('lista contas com apelido, saldo, favorita e desativada; nome escapado', () => {
    expect(html).toContain('@principal')
    expect(html).toContain('R$ 15,00')
    expect(html).toContain('-R$ 3,00')
    expect(html).toContain('Favorita')
    expect(html).toContain('Desativada')
    expect(html).toContain('&lt;b&gt;Nubank&lt;/b&gt;')
    expect(html).not.toContain('<b>Nubank</b>')
  })

  it('a favorita não tem botão de desativar; as outras têm; desativada tem reativar', () => {
    expect(html.match(/action="\/contas-correntes\/desativar"/g)).toHaveLength(1)
    expect(html.match(/action="\/contas-correntes\/reativar"/g)).toHaveLength(1)
    expect(html.match(/action="\/contas-correntes\/favoritar"/g)).toHaveLength(1) // só a ativa que não é favorita
  })

  it('formulário de criar com rótulos; menu marca a página atual', () => {
    expect(html).toMatch(/<label[^>]*for="apelido"/)
    expect(html).toMatch(/<label[^>]*for="nome"/)
    expect(html).toMatch(/<label[^>]*for="saldo"/)
    expect(html).toContain('action="/contas-correntes"')
    expect(html).toMatch(/href="\/contas-correntes" aria-current="page"/)
  })

  it('mostra erro e aviso', () => {
    expect(paginaContasCorrentes('a@x.com', false, lista, { erro: 'Apelido inválido.' })).toContain('Apelido inválido.')
    expect(paginaContasCorrentes('a@x.com', false, lista, { ok: 'Conta criada.' })).toContain('Conta criada.')
  })
})
```

- [ ] **Step 4: Implementar a página em `src/paginas.ts`**

Imports: acrescentar `import type { ContaCorrenteComSaldo } from './types'` (e `parseSaldo` não é usado aqui).

Ícone novo em `ICONES` (depois de `troca`):

```ts
  banco: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
```

Menu (linhas 231–234):

```ts
type Tela = 'painel' | 'dashboard' | 'contas-correntes' | 'admin' | 'perfil'
const NAV: Tela[] = ['painel', 'dashboard', 'contas-correntes', 'admin']
```

e em `TELAS` acrescente `'contas-correntes': ['Contas correntes', 'banco']`.

Antes de `// --- administração (convites)`, a página:

```ts
// --- contas correntes ------------------------------------------------------

export const ERROS_CC: Record<string, string> = {
  apelido_invalido: 'Apelido inválido. Use de 1 a 20 letras minúsculas sem acento, números, "-" ou "_", sem espaço.',
  apelido_em_uso: 'Você já tem uma conta com esse apelido.',
  nome_invalido: 'Informe um nome de até 40 caracteres.',
  saldo_invalido: 'Saldo inicial inválido. Use, por exemplo, 1500, 1.234,56 ou -50.',
  favorita: 'A conta favorita não pode ser desativada. Escolha outra como favorita antes.',
  inativa: 'Reative a conta antes de torná-la favorita.',
  nao_encontrada: 'Conta não encontrada.',
}
export const AVISOS_CC: Record<string, string> = {
  criada: 'Conta criada.',
  salva: 'Conta atualizada.',
  favorita: 'Conta favorita atualizada.',
  desativada: 'Conta desativada.',
  reativada: 'Conta reativada.',
}

// valor do campo "saldo" ao editar: 1.234,56 | -50,00 | 0,00 (formatBRL devolve "-R$ 50,00")
const saldoCampo = (c: ContaCorrenteComSaldo) => formatBRL(c.saldoInicial).replace('R$ ', '')

const itemContaCorrente = (c: ContaCorrenteComSaldo) => {
  const oculto = `<input type="hidden" name="id" value="${esc(c.id)}">`
  const acao = (rota: string, rotulo: string) => `<form method="post" action="/contas-correntes/${rota}">${oculto}<button class="btn sec pequeno">${rotulo}</button></form>`
  const status = [c.favorita ? '<span class="chip chip-ok">Favorita</span>' : '', !c.ativa ? '<span class="chip">Desativada</span>' : ''].join('')
  const favoritar = c.ativa && !c.favorita ? acao('favoritar', 'Tornar favorita') : ''
  const alternar = c.favorita ? '' : c.ativa ? acao('desativar', 'Desativar') : acao('reativar', 'Reativar')
  const editar = `<form method="post" action="/contas-correntes/editar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${oculto}<input name="nome" type="text" maxlength="40" required value="${esc(c.nome)}" aria-label="Nome de @${esc(c.apelido)}"><input name="saldo" type="text" inputmode="decimal" value="${esc(saldoCampo(c))}" aria-label="Saldo inicial de @${esc(c.apelido)}"><button class="btn sec pequeno">Salvar</button></form>`
  return `<li class="convite"><div><strong>${esc(c.nome)}</strong> <code>@${esc(c.apelido)}</code><div class="sub">Saldo atual: ${formatBRL(c.saldo)}</div></div>${status}${editar}${favoritar}${alternar}</li>`
}

export const paginaContasCorrentes = (email: string, admin: boolean, contas: ContaCorrenteComSaldo[], mensagem: { erro?: string; ok?: string } = {}, perfil?: Perfil) =>
  shell(
    'contas-correntes',
    email,
    admin ? 'admin' : 'usuario',
    `<main id="conteudo">${topo('Contas correntes', 'Os lançamentos vão para a conta favorita, ou para a que você indicar com @apelido')}${aviso(mensagem.erro)}${aviso(mensagem.ok, 'ok')}<div class="grade duas"><div class="cartao c5"><h2>Nova conta</h2><form method="post" action="/contas-correntes">${campo({ nome: 'apelido', rotulo: 'Apelido (usado no WhatsApp, ex.: @nubank)', extra: 'maxlength="20" pattern="[a-z0-9_-]{1,20}" autocapitalize="none"' })}${campo({ nome: 'nome', rotulo: 'Nome', extra: 'maxlength="40"' })}<div class="campo"><label for="saldo">Saldo inicial (opcional)</label><input id="saldo" name="saldo" type="text" inputmode="decimal" placeholder="0,00"></div><button class="btn">Adicionar conta</button></form></div><div class="cartao c7"><h2>Suas contas</h2>${contas.length ? `<ul class="convites">${contas.map(itemContaCorrente).join('')}</ul>` : vazio('banco', 'Nenhuma conta ainda.')}</div></div></main>`,
    '',
    perfil,
  )
```

O campo `apelido` usa `campo()`, que já marca `required`.

- [ ] **Step 5: Testes de rota (que falham)** — em `tests/web.test.ts`:

No topo, importar:

```ts
import { criarRepo } from '../src/repo'
import { criarContasCorrentes, type ContasCorrentes } from '../src/contasCorrentes'
```

Declarar `let contasCorrentes: ContasCorrentes` junto dos demais; no `beforeAll`, depois de `contas = await criarContas(...)`:

```ts
  await pool.query('DROP TABLE IF EXISTS contas_correntes')
  await criarRepo(pool) // cria `lancamentos` (a migração das contas correntes lê essa tabela)
  contasCorrentes = await criarContasCorrentes(pool)
```

e passar a opção em `criarWeb({ ..., contasCorrentes })`. Novo bloco de testes (antes de `describe('perfil', ...)`):

```ts
describe('contas correntes', () => {
  it('exige login', async () => {
    expect((await get('/contas-correntes')).headers.get('location')).toBe('/entrar')
    expect((await post('/contas-correntes', { apelido: 'x', nome: 'X' })).headers.get('location')).toBe('/entrar')
    expect((await post('/contas-correntes/favoritar', { id: 'x' })).headers.get('location')).toBe('/entrar')
  })

  it('GET mostra a Principal criada sozinha', async () => {
    const { cookie } = await entrar()
    const r = await get('/contas-correntes', cookie)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('@principal')
    expect(html).toContain('Favorita')
  })

  it('cria conta com saldo, mostra aviso e recusa dados inválidos com a chave de erro', async () => {
    const { cookie, conta } = await entrar()
    const ok = await post('/contas-correntes', { apelido: 'Nubank', nome: 'Nubank', saldo: '1.500,50' }, { cookie })
    expect(ok.headers.get('location')).toBe('/contas-correntes?ok=criada')
    expect(await contasCorrentes.doCliente(conta.id).porApelido('nubank')).toMatchObject({ nome: 'Nubank', saldoInicial: 150050 })
    expect((await post('/contas-correntes', { apelido: 'nubank', nome: 'Outra' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=apelido_em_uso')
    expect((await post('/contas-correntes', { apelido: 'com espaço', nome: 'X' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=apelido_invalido')
    expect((await post('/contas-correntes', { apelido: 'x1', nome: '  ' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=nome_invalido')
    expect((await post('/contas-correntes', { apelido: 'x2', nome: 'X', saldo: 'abc' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=saldo_invalido')
    expect(await (await get('/contas-correntes?ok=criada', cookie)).text()).toContain('Conta criada.')
    expect(await (await get('/contas-correntes?erro=apelido_em_uso', cookie)).text()).toContain('já tem uma conta com esse apelido')
    expect(await (await get('/contas-correntes?erro=<script>', cookie)).text()).not.toContain('<script>')
  })

  it('saldo inicial negativo e vazio', async () => {
    const { cookie, conta } = await entrar()
    await post('/contas-correntes', { apelido: 'neg', nome: 'Neg', saldo: '-50' }, { cookie })
    await post('/contas-correntes', { apelido: 'zero', nome: 'Zero', saldo: '' }, { cookie })
    expect((await contasCorrentes.doCliente(conta.id).porApelido('neg'))!.saldoInicial).toBe(-5000)
    expect((await contasCorrentes.doCliente(conta.id).porApelido('zero'))!.saldoInicial).toBe(0)
  })

  it('editar, favoritar, desativar e reativar', async () => {
    const { cookie, conta } = await entrar()
    await post('/contas-correntes', { apelido: 'nubank', nome: 'Nubank' }, { cookie })
    const nu = (await contasCorrentes.doCliente(conta.id).porApelido('nubank'))!
    expect((await post('/contas-correntes/editar', { id: nu.id, nome: 'Nu Conta', saldo: '10' }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=salva')
    expect(await contasCorrentes.doCliente(conta.id).porApelido('nubank')).toMatchObject({ nome: 'Nu Conta', saldoInicial: 1000 })
    expect((await post('/contas-correntes/editar', { id: nu.id, nome: ' ', saldo: '10' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=nome_invalido')
    expect((await post('/contas-correntes/editar', { id: nu.id, nome: 'X', saldo: 'abc' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=saldo_invalido')
    expect((await post('/contas-correntes/desativar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=desativada')
    expect((await post('/contas-correntes/favoritar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=inativa')
    expect((await post('/contas-correntes/reativar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=reativada')
    expect((await post('/contas-correntes/favoritar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=favorita')
    expect((await contasCorrentes.doCliente(conta.id).favorita()).id).toBe(nu.id)
    const principal = (await contasCorrentes.doCliente(conta.id).porApelido('principal'))!
    expect((await post('/contas-correntes/desativar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=favorita')
    expect((await post('/contas-correntes/desativar', { id: principal.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=desativada')
  })

  it('não mexe na conta de outro cliente', async () => {
    const a = await entrar()
    const b = await entrar()
    await post('/contas-correntes', { apelido: 'nubank', nome: 'Nubank' }, { cookie: a.cookie })
    const alvo = (await contasCorrentes.doCliente(a.conta.id).porApelido('nubank'))!
    for (const rota of ['editar', 'favoritar', 'desativar', 'reativar']) {
      const r = await post(`/contas-correntes/${rota}`, { id: alvo.id, nome: 'Invasor', saldo: '1' }, { cookie: b.cookie })
      expect(r.headers.get('location')).toBe('/contas-correntes?erro=nao_encontrada')
    }
    expect(await contasCorrentes.doCliente(a.conta.id).porApelido('nubank')).toMatchObject({ nome: 'Nubank', ativa: true, favorita: false })
  })

  it('POST de outra origem é recusado', async () => {
    const { cookie } = await entrar()
    const r = await post('/contas-correntes', { apelido: 'x', nome: 'X' }, { cookie, Origin: 'http://evil.example' })
    expect(r.status).toBe(403)
  })
})
```

- [ ] **Step 6: Implementar as rotas em `src/web.ts`**

Imports: `import type { ContasCorrentes } from './contasCorrentes'`; `import { parseSaldo } from './money'`; e em `./paginas` acrescente `AVISOS_CC`, `ERROS_CC`, `paginaContasCorrentes` à lista de imports.

`OpcoesWeb`: `contasCorrentes: ContasCorrentes`.

Dentro de `criarWeb`: `const { contas, sessoes, convites, contasCorrentes } = op` (ajuste a desestruturação existente).

Rota GET, depois do bloco de `/dashboard`:

```ts
      if (caminho === '/contas-correntes') {
        if (!conta) return ir(res, '/entrar')
        const chaveErro = url.searchParams.get('erro') ?? ''
        const chaveOk = url.searchParams.get('ok') ?? ''
        const mensagem = { erro: Object.hasOwn(ERROS_CC, chaveErro) ? ERROS_CC[chaveErro] : undefined, ok: Object.hasOwn(AVISOS_CC, chaveOk) ? AVISOS_CC[chaveOk] : undefined }
        return html(res, 200, paginaContasCorrentes(conta.email, isAdmin(conta), await contasCorrentes.listar(conta.id), mensagem, perfilDe(conta)))
      }
```

Rotas POST, depois de `if (!conta) return ir(res, '/entrar')` (por exemplo antes de `/painel/conectar`):

```ts
    if (caminho === '/contas-correntes') {
      const saldo = parseSaldo(f.get('saldo') ?? '')
      if (saldo === null) return ir(res, '/contas-correntes?erro=saldo_invalido')
      const r = await contasCorrentes.criar(conta.id, { apelido: f.get('apelido') ?? '', nome: f.get('nome') ?? '', saldoInicial: saldo })
      return ir(res, r.ok ? '/contas-correntes?ok=criada' : `/contas-correntes?erro=${r.erro}`)
    }
    if (caminho === '/contas-correntes/editar') {
      const saldo = parseSaldo(f.get('saldo') ?? '')
      if (saldo === null) return ir(res, '/contas-correntes?erro=saldo_invalido')
      const r = await contasCorrentes.editar(conta.id, f.get('id') ?? '', { nome: f.get('nome') ?? '', saldoInicial: saldo })
      return ir(res, r === 'ok' ? '/contas-correntes?ok=salva' : `/contas-correntes?erro=${r}`)
    }
    if (caminho === '/contas-correntes/favoritar') {
      const r = await contasCorrentes.favoritar(conta.id, f.get('id') ?? '')
      return ir(res, r === 'ok' ? '/contas-correntes?ok=favorita' : `/contas-correntes?erro=${r}`)
    }
    if (caminho === '/contas-correntes/desativar' || caminho === '/contas-correntes/reativar') {
      const ativar = caminho.endsWith('/reativar')
      const r = await contasCorrentes.definirAtiva(conta.id, f.get('id') ?? '', ativar)
      return ir(res, r === 'ok' ? `/contas-correntes?ok=${ativar ? 'reativada' : 'desativada'}` : `/contas-correntes?erro=${r}`)
    }
```

- [ ] **Step 7: `src/index.ts`** — passar a opção:

```ts
const web = criarWeb({
  contas,
  sessoes,
  convites,
  repo,
  contasCorrentes,
  mailer,
```

- [ ] **Step 8: Rodar**

Run: `npm run typecheck && npm test`
Expected: tudo verde. Se `tests/paginas.test.ts` tiver teste que conta os itens do menu ou compara a lista de telas, ajuste-o para incluir "Contas correntes" (é a mudança pedida); qualquer outra falha é regressão.

- [ ] **Step 9: Commit**

```bash
git add src tests
git commit -m "feat: página de contas correntes no portal"
```

---

### Task 6: Dashboard por conta, documentação e verificação final

**Files:**
- Modify: `src/web.ts` (rota `/dashboard`)
- Modify: `src/paginas.ts` (`paginaDashboard`)
- Modify: `tests/web.test.ts`, `tests/paginas.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `contasCorrentes.doCliente(id).porApelido`, `contasCorrentes.listar` (Task 1); `Leitura.balancete/serieMensal` com `contaCorrenteId` (Task 2); `paginaDashboard` atual.
- Produces: `paginaDashboard(email, ind, admin, perfil?, contas: { apelido: string; nome: string }[] = [], selecionada = '')`.

- [ ] **Step 1: Testes que falham**

Em `tests/paginas.test.ts` (`montarIndicadores` já está importado; o `ind` dos outros `describe` é local, então defina o seu):

```ts
describe('dashboard: seletor de conta', () => {
  const ind = montarIndicadores([{ ano: 2026, mes: 9, receitas: 100000, despesas: 25000 }], { receitas: [], despesas: [{ conta: 'mercado', total: 25000 }] })
  const contasSel = [{ apelido: 'principal', nome: 'Principal' }, { apelido: 'nubank', nome: 'Nubank' }]
  it('com 2+ contas mostra o seletor (formulário GET), com "Todas" e a selecionada marcada', () => {
    const html = paginaDashboard('a@x.com', ind, false, undefined, contasSel, 'nubank')
    expect(html).toContain('<form method="get" action="/dashboard">')
    expect(html).toContain('<option value="">Todas as contas</option>')
    expect(html).toContain('<option value="nubank" selected>Nubank</option>')
    expect(html).toContain('Nubank') // e o nome aparece no subtítulo
  })
  it('com uma conta só, nada de seletor', () => {
    expect(paginaDashboard('a@x.com', ind, false, undefined, [contasSel[0]])).not.toContain('<select')
    expect(paginaDashboard('a@x.com', ind, false)).not.toContain('<select')
  })
})
```

Em `tests/web.test.ts`, dentro de `describe('GET /dashboard', ...)`:

```ts
  it('com 2+ contas mostra o seletor; ?cc= filtra a leitura pela conta; apelido inexistente cai em "todas"', async () => {
    const { cookie, conta } = await entrar()
    await post('/contas-correntes', { apelido: 'nubank', nome: 'Nubank' }, { cookie })
    const nu = (await contasCorrentes.doCliente(conta.id).porApelido('nubank'))!
    const html = await (await get('/dashboard?cc=nubank', cookie)).text()
    expect(html).toContain('<select')
    expect(html).toContain('<option value="nubank" selected>Nubank</option>')
    expect(repoFalso.leitura).toHaveBeenLastCalledWith(conta.id)
    expect(spies.serie).toHaveBeenLastCalledWith(expect.any(Date), 6, nu.id)
    await get('/dashboard?cc=nao-existe', cookie)
    expect(spies.serie).toHaveBeenLastCalledWith(expect.any(Date), 6, undefined)
  })

  it('?cc= de apelido de outro cliente é ignorado', async () => {
    const a = await entrar()
    const b = await entrar()
    await post('/contas-correntes', { apelido: 'segredo', nome: 'Segredo' }, { cookie: a.cookie })
    await get('/dashboard?cc=segredo', b.cookie)
    expect(spies.serie).toHaveBeenLastCalledWith(expect.any(Date), 6, undefined)
  })
```

Para esses testes de web, troque o `repoFalso.leitura` no `beforeAll` por uma versão com espiões acessíveis (as asserções antigas de `toHaveBeenCalledWith(a.conta.id)` seguem valendo):

```ts
const spies = { serie: vi.fn(async (..._a: unknown[]) => [{ ano: 2026, mes: 9, receitas: 123400, despesas: 5600 }]), balancete: vi.fn(async (..._a: unknown[]) => ({ receitas: [], despesas: [{ conta: 'mercado-teste', total: 5600 }] })) }
```

(declarado junto de `let repoFalso`) e

```ts
    leitura: vi.fn((_id: string) => ({ serieMensal: spies.serie, balancete: spies.balancete })),
```

Os dois testes antigos que afirmam `expect(html).not.toContain('<select')` continuam verdadeiros: um cliente com só a "Principal" não vê seletor. Os `vi.clearAllMocks()` do `beforeEach` já limpam os espiões entre os testes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/web.test.ts tests/paginas.test.ts`
Expected: FAIL nos novos.

- [ ] **Step 3: `paginaDashboard` em `src/paginas.ts`** — nova assinatura e seletor:

```ts
const seletorConta = (contas: { apelido: string; nome: string }[], selecionada: string) =>
  contas.length < 2
    ? ''
    : `<form method="get" action="/dashboard" class="filtro-conta"><label for="cc">Conta</label> <select id="cc" name="cc"><option value="">Todas as contas</option>${contas.map((c) => `<option value="${esc(c.apelido)}"${c.apelido === selecionada ? ' selected' : ''}>${esc(c.nome)}</option>`).join('')}</select> <button class="btn sec pequeno">Aplicar</button></form>`

export const paginaDashboard = (email: string, ind: Indicadores, admin: boolean, perfil?: Perfil, contas: { apelido: string; nome: string }[] = [], selecionada = '') => {
```

No retorno do `shell`, o subtítulo e o seletor:

```ts
  const nomeSel = contas.find((c) => c.apelido === selecionada)?.nome
  return shell('dashboard', email, admin ? 'admin' : 'usuario', `<main id="conteudo" class="dash">${topo('Dashboard', `${nomeMes(ind.mes.ano, ind.mes.mes)}${nomeSel ? ` · ${nomeSel}` : ''}`)}${seletorConta(contas, selecionada)}${corpo}</main>`, '', perfil)
```

(`topo` já escapa o subtítulo.)

- [ ] **Step 4: Rota `/dashboard` em `src/web.ts`**

```ts
      if (caminho === '/dashboard') {
        if (!conta) return ir(res, '/entrar')
        const agora = new Date()
        const { ano, mes } = mesAtual(agora)
        const leitura = op.repo.leitura(conta.id) // sempre a própria conta; ?conta= é ignorado, até para admin
        // ?cc=apelido filtra por conta corrente; só vale apelido do próprio cliente (porApelido já é por cliente), senão mostra todas
        const apelido = url.searchParams.get('cc') ?? ''
        const selecionada = apelido ? await contasCorrentes.doCliente(conta.id).porApelido(apelido) : null
        const [serie, balancete, todas] = await Promise.all([
          leitura.serieMensal(agora, 6, selecionada?.id),
          leitura.balancete(intervaloDoMes(ano, mes), selecionada?.id),
          contasCorrentes.listar(conta.id),
        ])
        return html(res, 200, paginaDashboard(conta.email, montarIndicadores(serie, balancete), isAdmin(conta), perfilDe(conta), todas.map((c) => ({ apelido: c.apelido, nome: c.nome })), selecionada?.apelido ?? ''))
      }
```

(`Leitura` já aceita o 3º parâmetro por vir de `Repo`; nenhum tipo novo.)

- [ ] **Step 5: README** — em `README.md`:

Na tabela de comandos, acrescente linhas depois da linha de `/r plantão 450 ontem...`:

```markdown
| `/d mercado 45,90 @nubank`, `/r plantão 70 @itau` | lança em outra conta corrente: `@apelido` em qualquer posição. Sem `@`, vale a conta **favorita** |
| `/contas` (`/c`) | contas correntes ativas com apelido e saldo atual |
| `/balancete @nubank`, `/extrato 2 @nubank` | o mesmo relatório, só dessa conta (sem `@`, somam todas). `/auditoria` é sempre consolidada |
```

E uma seção nova antes de `### Administração`:

```markdown
### Contas correntes

Em `/contas-correntes` o cliente cadastra uma ou mais contas (apelido, nome e saldo inicial opcional) e escolhe a **favorita**. Todo lançamento do WhatsApp vai para a favorita; para outra conta, termine o comando com `@apelido`. O apelido é fixo depois de criado (minúsculas sem acento, números, `-` e `_`, até 20 caracteres); o nome e o saldo inicial podem ser editados. Contas não são excluídas, só desativadas (a favorita não pode ser desativada sem eleger outra), e o histórico das desativadas continua nos relatórios. O saldo atual de cada conta é o saldo inicial mais receitas menos despesas dos lançamentos dela. O dashboard ganha um seletor de conta quando há duas ou mais. Quem já usava o bot ganha uma conta "Principal" (`@principal`) com todos os lançamentos antigos, criada automaticamente na primeira subida.
```

- [ ] **Step 6: Suíte completa e typecheck**

Run: `npm run typecheck && npm test`
Expected: tudo verde.

- [ ] **Step 7: Verificação manual**

Run: `docker compose up -d postgres` e `npm start`; no portal: criar a conta `@nubank` com saldo inicial, tornar favorita, desativar a outra; no WhatsApp (grupo do piloto): `/d mercado 10`, `/d farmácia 20 @principal`, `/contas`, `/b @principal`, `/e`. Confirme a confirmação com o nome da conta, os saldos de `/contas` e o seletor do dashboard. Se não for possível testar com WhatsApp real, diga isso no relatório final em vez de afirmar que funcionou.

- [ ] **Step 8: Commit**

```bash
git add src tests README.md
git commit -m "feat: dashboard por conta corrente e documentação"
```
