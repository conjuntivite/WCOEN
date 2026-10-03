# Transferência entre contas correntes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O cliente transfere dinheiro de uma conta corrente sua para outra com `/t valor @origem @destino` no WhatsApp; o saldo das duas contas muda, mas a transferência não entra em receitas, despesas, balancete, auditoria nem dashboard.

**Architecture:** Uma transferência é **uma linha** em `lancamentos` com `tipo = 'transferencia'`, `conta_corrente_id` = origem e `conta_destino_id` = destino (coluna nova). Balancete e série mensal já filtram por receita/despesa, então ignoram a linha sozinhos; o saldo (`listar` em `contasCorrentes.ts`) passa a somar entradas e subtrair saídas de transferência; extrato, balancete do dia e `/desfazer` tratam a linha como um lançamento comum.

**Tech Stack:** TypeScript (ESM, Node >= 20.6), `pg`, vitest. Mesmo projeto das contas correntes (PR #15).

**Spec:** `docs/superpowers/specs/2026-10-02-transferencia-entre-contas-design.md` (depende de `docs/superpowers/specs/2026-10-02-contas-correntes-design.md`).

## Global Constraints

- Idioma: mensagens, rótulos e comentários em pt-BR; identificadores no padrão do projeto.
- Transferência é sempre entre duas contas correntes **do mesmo cliente**. `origem` sai o dinheiro; `destino` recebe.
- Linha da transferência: `tipo = 'transferencia'`, `conta = 'transferência'`, `conta_corrente_id` = origem, `conta_destino_id` = destino, `valor` em centavos positivo.
- `/t valor @origem @destino` (alias `/transferencia`): o **primeiro** `@` é a origem, o segundo o destino. Com um `@` só, a origem é a conta **favorita** e o `@` é o destino. Data opcional no fim (`ontem`, `15/09`, `15/09/2026`); os `@` podem vir em qualquer posição em relação ao valor e à data.
- Sem valor, sem `@`, mais de dois `@`, `@` malformado ou texto sobrando: dica de uso, nada gravado.
- Origem igual ao destino: nada gravado, resposta "Origem e destino são a mesma conta". Origem ou destino inexistente ou desativado: nada gravado, resposta "conta não encontrada" com as contas ativas.
- Não bloqueia por saldo insuficiente.
- `saldo atual = saldo inicial + receitas − despesas − transferências que saíram + transferências que entraram`, sem desfeitos, de todas as datas, calculado em SQL.
- Balancete, resumos, auditoria e dashboard ignoram transferências (e a auditoria não as envia à IA). Extrato (`/e`) e balancete do dia (`/b`) mostram a linha `🔁 origem → destino` **sem** entrar nos totais. `/e @conta` mostra transferências em que a conta é origem **ou** destino.
- `/desfazer` desfaz a transferência (uma linha, as duas pontas) com a mensagem `↩️ TRANSFERÊNCIA DESFEITA`.
- Sem tela nova no portal. Sem dependência nova. Os testes de Postgres exigem `docker compose up -d postgres`.

## Review Focus

- Só transferências no período: `/b mensal` e a auditoria dizem "Nenhum lançamento no período"; `/b` do dia mostra a linha com receitas e despesas em R$ 0,00 (Tasks 1 e 3).
- `/t 500 @a @a` e `/t 500 @principal` quando a favorita já é a Principal: "mesma conta", nada gravado (Task 3).
- Mais de dois `@`, valor ausente ou lixo (`/t abc @a`, `/t 0 @a`, `/t -5 @a`, `/t 500 600 @a`): dica de uso (Task 2).
- Origem ou destino desativado: nada gravado (Task 3).
- Transferência desfeita volta o saldo das duas contas e some do extrato (Tasks 1 e 3).
- Conta desativada que teve transferência ainda aparece pelo nome na linha do extrato (Tasks 1 e 3).
- Saldo da origem pode ficar negativo: nenhum bloqueio (Task 1).
- A mensagem recuperada (offline) com `/t` é gravada como qualquer lançamento (Task 3 não a bloqueia).

---

### Task 1: Dados: tipo, coluna, saldo e nomes das contas

**Files:**
- Modify: `src/types.ts`, `src/repo.ts`, `src/contasCorrentes.ts`, `src/service.ts` (só a auditoria), `src/presentation.ts` (só `icone` e `sinal`)
- Modify: `tests/memoryRepo.ts`, `tests/memoryContasCorrentes.ts`, `tests/repo.contract.ts`, `tests/contasCorrentes.test.ts`, `tests/service.test.ts`

**Interfaces:**
- Consumes: tudo das contas correntes (PR #15).
- Produces (usado pelas Tasks 2 e 3):
  - `types.ts`: `TipoLancamento = Natureza | 'transferencia'`; `NovoLancamento.tipo: TipoLancamento` e `NovoLancamento.contaDestinoId?: string`; `Lancamento` herda.
  - `ContasDoCliente.nomes(): Promise<Record<string, string>>` (id → nome, **todas** as contas do cliente, ativas ou não).
  - `Repo.extrato(intervalo, contaCorrenteId?)` passa a casar a conta como origem **ou** destino; `balancete` e `serieMensal` continuam ignorando transferência.
  - `listar` (saldo) considera transferência.
  - `tests/memoryContasCorrentes.ts`: `contasEmMemoria()` ganha `nomes`.

- [ ] **Step 0: Branch nova**

```bash
git checkout -b feat/transferencia-entre-contas
git add docs/superpowers/specs/2026-10-02-transferencia-entre-contas-design.md docs/superpowers/plans/2026-10-02-transferencia-entre-contas.md
git commit -m "docs: spec e plano de transferência entre contas"
```

- [ ] **Step 1: Testes que falham — contrato do repo.** Em `tests/repo.contract.ts`, antes do `  })\n}` final do arquivo (depois do teste `'o lançamento guarda a conta corrente'`), acrescente:

```ts
    it('transferência: guarda origem e destino, fica fora de balancete e série, e o extrato filtra por origem ou destino', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'mercado', valor: 1000, contaCorrenteId: 'cc1' }))
      await repo.add(novo({ tipo: 'transferencia', conta: 'transferência', valor: 500, contaCorrenteId: 'cc1', contaDestinoId: 'cc2' }))
      const mes = { de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') }
      expect((await repo.balancete(null)).despesas).toEqual([{ conta: 'mercado', total: 1000 }])
      expect((await repo.balancete(null)).receitas).toEqual([])
      expect((await repo.balancete(null, 'cc2')).despesas).toEqual([])
      expect(await repo.serieMensal(new Date('2026-09-30T12:00:00Z'), 1)).toEqual([{ ano: 2026, mes: 9, receitas: 0, despesas: 1000 }])
      expect((await repo.extrato(mes, 'cc2')).map((l) => [l.tipo, l.contaCorrenteId, l.contaDestinoId])).toEqual([['transferencia', 'cc1', 'cc2']])
      expect((await repo.extrato(mes, 'cc1')).map((l) => l.tipo)).toEqual(['despesa', 'transferencia'])
      expect((await repo.extrato(mes)).map((l) => l.tipo)).toEqual(['despesa', 'transferencia'])
    })

    it('desfazer uma transferência devolve a linha com origem e destino e a tira do extrato', async () => {
      const repo = await criar()
      await repo.add(novo({ tipo: 'transferencia', conta: 'transferência', valor: 500, contaCorrenteId: 'cc1', contaDestinoId: 'cc2' }))
      expect(await repo.desfazerUltimo()).toMatchObject({ tipo: 'transferencia', contaCorrenteId: 'cc1', contaDestinoId: 'cc2', valor: 500 })
      expect(await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })).toEqual([])
    })
```

- [ ] **Step 2: Testes que falham — saldo e nomes.** Em `tests/contasCorrentes.test.ts`, depois do helper `lancar` (no topo), acrescente o helper:

```ts
const transferir = (contaId: string, origemId: string, destinoId: string, valor: number, desfeito = false) =>
  pool.query(
    `INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em, conta_corrente_id, conta_destino_id)
     VALUES ($1,'transferencia','transferência',$2,'u',gen_random_uuid()::text,now(),now(),$3,$4,$5)`,
    [contaId, valor, desfeito ? new Date() : null, origemId, destinoId],
  )
```

E, no fim do arquivo, acrescente:

```ts
describe('transferências no saldo e nomes', () => {
  it('a transferência tira da origem e põe no destino; a desfeita não conta; o saldo pode ficar negativo', async () => {
    const principal = await cc.doCliente('c1').favorita()
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 10000 })
    const nubank = r.ok ? r.conta : null
    await transferir('c1', nubank!.id, principal.id, 3000)
    await transferir('c1', principal.id, nubank!.id, 500)
    await transferir('c1', nubank!.id, principal.id, 999, true) // desfeita: não conta
    await transferir('c1', principal.id, nubank!.id, 100000) // deixa a Principal negativa: sem bloqueio
    await lancar('c1', principal.id, 'receita', 200)
    const lista = await cc.listar('c1')
    expect(lista.find((c) => c.apelido === 'nubank')!.saldo).toBe(10000 - 3000 + 500 + 100000)
    expect(lista.find((c) => c.apelido === 'principal')!.saldo).toBe(3000 - 500 - 100000 + 200)
  })

  it('nomes devolve id → nome de todas as contas do cliente, inclusive desativadas, e só dele', async () => {
    const principal = await cc.doCliente('c1').favorita()
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const nubank = r.ok ? r.conta : null
    await cc.definirAtiva('c1', nubank!.id, false)
    await cc.criar('c2', { apelido: 'x', nome: 'Outra', saldoInicial: 0 })
    expect(await cc.doCliente('c1').nomes()).toEqual({ [principal.id]: 'Principal', [nubank!.id]: 'Nubank' })
  })
})
```

- [ ] **Step 3: Teste que falha — auditoria ignora transferência.** Em `tests/service.test.ts`, no fim do arquivo (o `Auditor` e o `vi` já estão importados; `agora`, `msg` e `contasEmMemoria` já existem), acrescente:

```ts
describe('Service: transferências fora da auditoria', () => {
  it('só com transferências no período, a auditoria diz que não há lançamentos e não chama a IA', async () => {
    const repo = new MemoryRepo()
    await repo.add({ tipo: 'transferencia', conta: 'transferência', valor: 500, remetente: 'u', msgId: 't1', data: new Date('2026-09-10T12:00:00Z'), enviadoEm: new Date('2026-09-10T12:00:00Z'), contaCorrenteId: 'cc1', contaDestinoId: 'cc2' })
    const auditor: Auditor = { sugerir: vi.fn(async () => ['dica']) }
    const r = await new Service(repo, contasEmMemoria(), agora, auditor).handle(msg('/auditoria'))
    expect(r?.texto).toContain('Nenhum lançamento no período')
    expect(auditor.sugerir).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run tests/memoryRepo.test.ts tests/pgRepo.test.ts tests/contasCorrentes.test.ts tests/service.test.ts`
Expected: FAIL nos testes novos (memória quebra ao somar `somas['transferencia']`; Postgres: coluna `conta_destino_id` inexistente; `nomes is not a function`; a auditoria chama a IA).

- [ ] **Step 5: `src/types.ts`.** Troque a primeira linha e a linha de `NovoLancamento`:

```ts
export type Natureza = 'despesa' | 'receita'
// 'transferencia' não é receita nem despesa: move dinheiro entre duas contas correntes do cliente (origem = contaCorrenteId, destino = contaDestinoId)
export type TipoLancamento = Natureza | 'transferencia'
```

```ts
export type NovoLancamento = { tipo: TipoLancamento; conta: string; valor: number; remetente: string; msgId: string; data: Date; enviadoEm: Date; contaCorrenteId: string; contaDestinoId?: string }
```

Na interface `ContasDoCliente`, depois de `porId`, acrescente:

```ts
  nomes(): Promise<Record<string, string>> // id → nome de todas as contas do cliente, ativas ou não (para rotular transferências antigas)
```

- [ ] **Step 6: `src/repo.ts`.**

Import: `import type { Balancete, Intervalo, Lancamento, Leitura, MesSerie, Natureza, NovoLancamento, Repo, TipoLancamento } from './types'`.

`Row`: troque `tipo: Natureza` por `tipo: TipoLancamento` e acrescente `conta_destino_id: string | null` depois de `conta_corrente_id: string`.

`paraLancamento`: depois de `contaCorrenteId: r.conta_corrente_id,` acrescente `...(r.conta_destino_id && { contaDestinoId: r.conta_destino_id }),`.

`add`:

```ts
      await this.pool.query(
        'INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em, conta_corrente_id, conta_destino_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [this.contaId, l.tipo, l.conta, l.valor, l.remetente, l.msgId, l.data, l.enviadoEm, l.contaCorrenteId, l.contaDestinoId ?? null],
      )
```

`desfazerUltimo`, no `RETURNING`: `... l.desfeito_em, l.conta_corrente_id, l.conta_destino_id`.

`extrato` (query e filtro casam origem **ou** destino):

```ts
      `SELECT tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em, conta_corrente_id, conta_destino_id FROM lancamentos
       WHERE conta_id = $1 AND desfeito_em IS NULL AND data >= $2 AND data < $3
         AND ($4::text IS NULL OR conta_corrente_id = $4 OR conta_destino_id = $4)
       ORDER BY data ASC, enviado_em ASC, id ASC`,
```

Em `balancete` e `serieMensal`, os tipos genéricos das linhas (`tipo: Natureza`) passam a `tipo: TipoLancamento` (as linhas agora podem ser `'transferencia'`; os filtros por `'receita'`/`'despesa'` já as ignoram). Em `criarRepo`, depois da linha do índice `lancamentos_cc`:

```sql
    ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS conta_destino_id TEXT;
    CREATE INDEX IF NOT EXISTS lancamentos_cc_destino ON lancamentos (conta_destino_id);
```

- [ ] **Step 7: `tests/memoryRepo.ts`.** No `extrato`, o filtro de conta vira:

```ts
 && (!contaCorrenteId || x.item.contaCorrenteId === contaCorrenteId || x.item.contaDestinoId === contaCorrenteId))
```

No `balancete`, logo depois de `if (i.desfeitoEm) continue`, acrescente `if (i.tipo === 'transferencia') continue` (não é receita nem despesa). A `serieMensal` já soma por tipo, sem mudança.

- [ ] **Step 8: Saldo e nomes em `src/contasCorrentes.ts`.**

Em `listar`, troque o `COALESCE(...)` e o `LEFT JOIN`:

```ts
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
```

(Na transferência, `conta_corrente_id` é a origem e `conta_destino_id` o destino: para a conta de destino soma, para a de origem subtrai.) Em `doCliente`, depois de `porId`, acrescente:

```ts
    async nomes() {
      const r = await pool.query<{ id: string; nome: string }>('SELECT id, nome FROM contas_correntes WHERE conta_id = $1', [contaId])
      return Object.fromEntries(r.rows.map((x) => [x.id, x.nome]))
    },
```

- [ ] **Step 9: `tests/memoryContasCorrentes.ts`.** Dentro do objeto devolvido por `contasEmMemoria`, depois de `porId`, acrescente:

```ts
    nomes: async () => Object.fromEntries(lista.map((c) => [c.id, c.nome])),
```

- [ ] **Step 10: Auditoria ignora transferência, em `src/service.ts`.** Perto de `somaTipo` (topo do arquivo), acrescente:

```ts
// transferência não é receita nem despesa: fica fora de totais e da auditoria
const soReceitaDespesa = (ls: Lancamento[]) => ls.filter((l): l is Lancamento & { tipo: Natureza } => l.tipo !== 'transferencia')
```

No método `auditoria`, troque `const extrato = await this.repo.extrato(atual)` por `const extrato = soReceitaDespesa(await this.repo.extrato(atual))`.

- [ ] **Step 11: `icone` e `sinal` em `src/presentation.ts`** (a linha do `Lancamento` agora pode ser transferência). Import `TipoLancamento` junto de `Lancamento`/`Natureza`, e troque:

```ts
const sinal = (t: TipoLancamento, valor: number) => bold(t === 'transferencia' ? formatBRL(valor) : `${t === 'receita' ? '+' : '−'} ${formatBRL(valor)}`)
const icone = (t: TipoLancamento) => (t === 'receita' ? '🟢' : t === 'despesa' ? '🔴' : '🔁')
```

- [ ] **Step 12: Rodar até passar**

Run: `npm run typecheck && npx vitest run tests/memoryRepo.test.ts tests/pgRepo.test.ts tests/contasCorrentes.test.ts tests/service.test.ts`
Expected: PASS. Se o typecheck apontar outro uso de `Lancamento.tipo` assumindo `Natureza`, estreite com `l.tipo !== 'transferencia'` (ou use `soReceitaDespesa`).

- [ ] **Step 13: Suíte e commit**

Run: `npm test`
Expected: tudo verde.

```bash
git add src tests
git commit -m "feat: transferência entre contas na camada de dados, saldo e auditoria"
```

---

### Task 2: Parser: `/t`

**Files:**
- Modify: `src/parser.ts`, `src/presentation.ts` (só `USO`), `src/service.ts` (caso provisório)
- Modify: `tests/parser.test.ts`

**Interfaces:**
- Consumes: `parseValor`, `lerData`, `APELIDO` (já no parser).
- Produces (usado pela Task 3): `Comando` ganha `{ tipo: 'transferencia'; valor: number; data?: DataLanc; origem?: string; destino: string }` (apelidos sem `@`, minúsculos; `origem` só existe quando o usuário digitou dois `@`); `{ tipo: 'uso'; comando: 'transferencia' }`; `ui.USO.transferencia`.

- [ ] **Step 1: Testes que falham.** Acrescente ao fim de `tests/parser.test.ts`:

```ts
describe('parse: transferência (/t)', () => {
  it.each([
    ['/t 500 @nubank @itau', { tipo: 'transferencia', valor: 50000, origem: 'nubank', destino: 'itau' }],
    ['/t 500 @itau', { tipo: 'transferencia', valor: 50000, destino: 'itau' }],
    ['/transferencia 1.234,56 @a @b', { tipo: 'transferencia', valor: 123456, origem: 'a', destino: 'b' }],
    ['/t @nubank 500 @itau', { tipo: 'transferencia', valor: 50000, origem: 'nubank', destino: 'itau' }],
    ['/t R$ 45,90 @itau', { tipo: 'transferencia', valor: 4590, destino: 'itau' }],
    ['/T 500 @NuBank @Itau', { tipo: 'transferencia', valor: 50000, origem: 'nubank', destino: 'itau' }],
  ])('%j', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('data opcional, antes ou depois dos @', () => {
    expect(parse('/t 500 @a @b ontem')).toEqual({ tipo: 'transferencia', valor: 50000, origem: 'a', destino: 'b', data: { tipo: 'relativa', diasAtras: 1 } })
    expect(parse('/t 500 ontem @a @b')).toEqual({ tipo: 'transferencia', valor: 50000, origem: 'a', destino: 'b', data: { tipo: 'relativa', diasAtras: 1 } })
    expect(parse('/t 500 @itau 15/09')).toEqual({ tipo: 'transferencia', valor: 50000, destino: 'itau', data: { tipo: 'dia', dia: 15, mes: 9, ano: undefined } })
  })

  it.each([['/t'], ['/t 500'], ['/t @a'], ['/t 500 @a @b @c'], ['/t 500 @'], ['/t abc @a'], ['/t 0 @a'], ['/t -5 @a'], ['/t 500 600 @a'], ['/t 500 @com.ponto @b'], ['/t 500 mercado @a']])(
    'uso incorreto: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'transferencia' })
    },
  )
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/parser.test.ts`
Expected: FAIL nos testes de `/t` (o comando ainda não existe: `parse` devolve `null`).

- [ ] **Step 3: Implementar em `src/parser.ts`.**

`Comando` ganha, antes da linha de `desfazer`:

```ts
  | { tipo: 'transferencia'; valor: number; data?: DataLanc; origem?: string; destino: string } // origem ausente = a conta favorita
```

e a união de `uso` passa a incluir `'transferencia'`:

```ts
  | { tipo: 'uso'; comando: 'balancete' | 'auditoria' | 'extrato' | 'despesa' | 'receita' | 'transferencia' } // uso incorreto: o service responde a dica
```

`Nome` e `COMANDOS`:

```ts
type Nome = 'despesa' | 'receita' | 'balancete' | 'extrato' | 'auditoria' | 'desfazer' | 'ajuda' | 'contas' | 'transferencia'
```

```ts
  ['c', 'contas'], ['contas', 'contas'],
  ['t', 'transferencia'], ['transferencia', 'transferencia'],
])
```

Em `parse`, logo depois da linha `const resto = palavras.join(' ')` e antes de `if (nome === 'extrato')`, acrescente:

```ts
  // "/t valor @origem @destino [data]": com um @ só, é o destino e a origem é a favorita (o service resolve)
  if (nome === 'transferencia') {
    const apelidos = marcas.map((m) => APELIDO.exec(m)?.[1])
    const data = palavras.length ? lerData(palavras[palavras.length - 1]) : null
    const itens = data ? palavras.slice(0, -1) : palavras
    const valor = itens.length === 1 ? parseValor(itens[0]) : null
    if (valor === null || apelidos.length < 1 || apelidos.length > 2 || apelidos.some((a) => !a)) return { tipo: 'uso', comando: 'transferencia' }
    const [primeiro, segundo] = apelidos as string[]
    return { tipo: 'transferencia', valor, ...(data && { data }), ...(segundo ? { origem: primeiro, destino: segundo } : { destino: primeiro }) }
  }
```

- [ ] **Step 4: Tipos que acompanham.** Em `src/presentation.ts`, o objeto `USO` ganha a chave:

```ts
  transferencia: uso('/t 500 @nubank @itau', '/t 500 @itau', '/t 500 @nubank @itau ontem'),
```

Em `src/service.ts`, no `switch` de `executar`, antes de `case 'ajuda':`, acrescente o caso provisório (a Task 3 o substitui):

```ts
      case 'transferencia': // provisório: implementado na Task 3
        return null
```

- [ ] **Step 5: Rodar até passar**

Run: `npm run typecheck && npx vitest run tests/parser.test.ts`
Expected: PASS.

- [ ] **Step 6: Suíte e commit**

Run: `npm test`
Expected: tudo verde.

```bash
git add src tests
git commit -m "feat: parser com /t (transferência entre contas)"
```

---

### Task 3: Service e mensagens: gravar, mostrar e desfazer a transferência

**Files:**
- Modify: `src/service.ts`, `src/presentation.ts`, `README.md`
- Modify: `tests/service.test.ts`, `tests/presentation.test.ts` (só se algum texto de ajuda for comparado literalmente)

**Interfaces:**
- Consumes: `Comando` `transferencia` (Task 2); `NovoLancamento.contaDestinoId`, `ContasDoCliente.nomes` (Task 1); `contaNaoEncontrada` (já em `presentation.ts`).
- Produces: nada para outras tasks.

- [ ] **Step 1: Testes que falham.** Em `tests/service.test.ts`, no fim do arquivo (usa `comDuasContas`, `PRINCIPAL`, `NUBANK`, `ANTIGA`, `mes`, `agora`, `msg`, `secoes`, `USO`, `MemoryRepo`, `contasEmMemoria`, `ERRO_SALVAR` e `vi`, todos já no arquivo), acrescente:

```ts
describe('Service: transferência entre contas', () => {
  const hoje = '2026-09-15T12:00:00Z' // o `agora` do Service: o /b do dia só mostra lançamentos de hoje
  const ZERADOS = '🟢 Receitas\n*R$ 0,00*'

  it('com dois @, o primeiro é a origem e o segundo o destino; grava uma linha só', async () => {
    const repo = new MemoryRepo()
    const r = await comDuasContas(repo).handle(msg('/t 500 @nubank @principal'))
    expect(r).toEqual({ texto: '🔁 *TRANSFERÊNCIA REGISTRADA*\n\n🏦 _Nubank → Principal_\n💰 *R$ 500,00*', lancou: true })
    const itens = await repo.extrato(mes)
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ tipo: 'transferencia', conta: 'transferência', valor: 50000, contaCorrenteId: 'cc2', contaDestinoId: 'cc1' })
  })

  it('com um @ só, sai da favorita; com data, a confirmação mostra o dia', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    expect((await s.handle(msg('/t 500 @nubank')))?.texto).toBe('🔁 *TRANSFERÊNCIA REGISTRADA*\n\n🏦 _Principal → Nubank_\n💰 *R$ 500,00*')
    expect((await s.handle(msg('/t 70 @nubank ontem')))?.texto).toContain('📅')
    expect((await repo.extrato(mes))[0]).toMatchObject({ contaCorrenteId: 'cc1', contaDestinoId: 'cc2' })
  })

  it('mesma conta (explícita ou favorita igual ao destino): nada é gravado', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    for (const texto of ['/t 500 @nubank @nubank', '/t 500 @principal']) {
      const r = await s.handle(msg(texto))
      expect(r?.lancou).toBe(false)
      expect(r?.texto).toContain('MESMA CONTA')
    }
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('origem ou destino inexistente ou desativado: nada é gravado e lista as contas ativas', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    for (const texto of ['/t 500 @nada', '/t 500 @nada @nubank', '/t 500 @nubank @nada', '/t 500 @antiga', '/t 500 @antiga @nubank']) {
      const r = await s.handle(msg(texto))
      expect(r?.lancou).toBe(false)
      expect(r?.texto).toContain('CONTA NÃO ENCONTRADA')
      expect(r?.texto).toContain('@nubank')
    }
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('uso incorreto devolve a dica, sem gravar', async () => {
    const repo = new MemoryRepo()
    const dica = USO('/t 500 @nubank @itau', '/t 500 @itau', '/t 500 @nubank @itau ontem')
    expect((await comDuasContas(repo).handle(msg('/t 500')))?.texto).toBe(dica)
    expect((await comDuasContas(repo).handle(msg('/t 500 @a @b @c')))?.texto).toBe(dica)
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('o extrato e o balancete do dia mostram a linha, sem entrar nos totais', async () => {
    const s = comDuasContas()
    await s.handle(msg('/t 500 @nubank @principal', hoje))
    for (const texto of ['/e', '/b']) {
      const t = (await s.handle(msg(texto)))?.texto ?? ''
      expect(t).toContain('🔁 _Nubank → Principal_')
      expect(t).toContain(ZERADOS)
      expect(t).toContain('🔴 Despesas\n*R$ 0,00*')
    }
  })

  it('/e @conta mostra a transferência na origem e no destino; conta sem movimento não', async () => {
    const s = comDuasContas()
    await s.handle(msg('/t 500 @nubank @principal', hoje))
    expect((await s.handle(msg('/e @nubank')))?.texto).toContain('🔁')
    expect((await s.handle(msg('/e @principal')))?.texto).toContain('🔁')
    expect((await s.handle(msg('/e @antiga')))?.texto).toContain('Nenhum lançamento')
  })

  it('balancete mensal ignora transferências', async () => {
    const s = comDuasContas()
    await s.handle(msg('/t 500 @nubank @principal', hoje))
    expect((await s.handle(msg('/b mensal')))?.texto).toContain('Nenhum lançamento no período')
  })

  it('/desfazer desfaz a transferência, diz origem e destino e a tira do extrato', async () => {
    const s = comDuasContas()
    await s.handle(msg('/t 500 @nubank @principal'))
    expect((await s.handle(msg('/desfazer')))?.texto).toBe('↩️ *TRANSFERÊNCIA DESFEITA*\n\n🏦 _Nubank → Principal_\n💰 *R$ 500,00*')
    expect((await s.handle(msg('/e')))?.texto).toContain('Nenhum lançamento')
  })

  it('falha ao gravar responde ERRO_SALVAR e o mesmo msgId pode ser tentado de novo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const repo = new MemoryRepo()
    vi.spyOn(repo, 'add').mockRejectedValueOnce(new Error('x'))
    const s = comDuasContas(repo)
    expect((await s.handle(msg('/t 5 @nubank', undefined, 'r9')))?.texto).toBe(ERRO_SALVAR)
    expect((await s.handle(msg('/t 5 @nubank', undefined, 'r9')))?.lancou).toBe(true)
  })

  it('/ajuda cita a transferência', async () => {
    expect((await novoService().handle(msg('/ajuda')))?.texto).toContain('/t 500')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/service.test.ts`
Expected: FAIL nos testes novos (o caso provisório devolve `null`; ajuda sem `/t`).

- [ ] **Step 3: `src/presentation.ts`.**

Perto de `lancamentoRegistrado`, acrescente as mensagens da transferência:

```ts
export function transferenciaRegistrada(t: { origem: string; destino: string; valor: number; dia?: Date }): string {
  const linhas = [`🏦 ${italic(`${limpar(t.origem)} → ${limpar(t.destino)}`)}`, `💰 ${bold(formatBRL(t.valor))}`, ...(t.dia ? [`📅 ${italic(rotuloDia(t.dia))}`] : [])]
  return `${cabecalho('🔁', 'TRANSFERÊNCIA REGISTRADA')}\n\n${linhas.join('\n')}`
}

export const transferenciaDesfeita = (t: { origem: string; destino: string; valor: number }) =>
  `${cabecalho('↩️', 'TRANSFERÊNCIA DESFEITA')}\n\n🏦 ${italic(`${limpar(t.origem)} → ${limpar(t.destino)}`)}\n💰 ${bold(formatBRL(t.valor))}`

export const TRANSFERENCIA_MESMA_CONTA = erro('🔁', 'MESMA CONTA', 'Origem e destino são a mesma conta.', 'Nenhuma transferência foi registrada.')
```

Para mostrar a linha de transferência nos relatórios, acrescente o helper (perto de `sinal`/`icone`):

```ts
// descrição da linha do extrato: a do lançamento ou, na transferência, "origem → destino" (nomes por id; desativadas incluídas)
const descricaoDe = (l: Lancamento, nomes: Record<string, string>) =>
  l.tipo === 'transferencia' ? `${limpar(nomes[l.contaCorrenteId] ?? '?')} → ${limpar(nomes[l.contaDestinoId ?? ''] ?? '?')}` : limpar(l.conta)
```

`balanceteDoDia` e `extrato` ganham o parâmetro `nomes` (último, com padrão `{}`) e usam `descricaoDe`:

```ts
export function balanceteDoDia(agora: Date, itens: Lancamento[], receitas: number, despesas: number, filtro?: string, nomes: Record<string, string> = {}): string {
  const cab = cabecalho('📊', 'BALANCETE DO DIA', comFiltro(dataCompleta(agora), filtro))
  if (!itens.length) return `${cab}\n\n${italic('Nenhum lançamento registrado hoje.')}`
  const linhas = itens.map((l) => `🕐 ${bold(rotuloHora(l.enviadoEm))}\n${icone(l.tipo)} ${descricaoDe(l, nomes)}\n${sinal(l.tipo, l.valor)}`)
  return secoes(cab, linhas.join('\n\n'), totais(receitas, despesas))
}
```

```ts
export function extrato(pagina: number, total: number, itens: Lancamento[], geral: { receitas: number; despesas: number } | null, filtro?: string, nomes: Record<string, string> = {}): string {
  const linhas = itens
    .map((l) => `📅 ${bold(`${rotuloDia(l.data)} · ${rotuloHora(l.enviadoEm)}`)}\n${icone(l.tipo)} ${l.tipo === 'transferencia' ? italic(descricaoDe(l, nomes)) : italic(limpar(l.conta))}\n${sinal(l.tipo, l.valor)}`)
    .join('\n\n')
```

(o resto de `extrato` fica como está).

Na `AJUDA`, no bloco `🏦 CONTAS`, acrescente a transferência. O bloco passa a ser:

```ts
  [`🏦 ${bold('CONTAS')}`, `${cmd('/contas')}\n${italic('contas e saldos')}\n\n${cmd('/balancete @conta')}\n${cmd('/extrato @conta')}\n${italic('relatório de uma conta só')}`, `🔁 Transferência entre contas\n${cmd('/t 500 @nubank @itau')}\n${italic('sai do primeiro, vai para o segundo')}\n${cmd('/t 500 @itau')}\n${italic('sai da conta favorita')}`].join('\n\n'),
```

- [ ] **Step 4: `src/service.ts`.**

Em `handle`, a lista de comandos que gravam passa a incluir a transferência:

```ts
      const gravando = cmd.tipo === 'lancamento' || cmd.tipo === 'transferencia' || cmd.tipo === 'desfazer'
```

Substitua o caso provisório por:

```ts
      case 'transferencia': {
        const origem = cmd.origem ? await this.contasCC.porApelido(cmd.origem) : await this.contasCC.favorita()
        if (!origem || !origem.ativa) return { texto: ui.contaNaoEncontrada(cmd.origem ?? '', await this.contasCC.ativas(), true), lancou: false }
        const destino = await this.contasCC.porApelido(cmd.destino)
        if (!destino || !destino.ativa) return { texto: ui.contaNaoEncontrada(cmd.destino, await this.contasCC.ativas(), true), lancou: false }
        if (origem.id === destino.id) return { texto: ui.TRANSFERENCIA_MESMA_CONTA, lancou: false }
        // sem data informada pelo usuário, vale a data de envio da mensagem
        const data = cmd.data ? resolverData(cmd.data, msg.enviadoEm) : msg.enviadoEm
        if (!data) return { texto: ui.ERRO_DATA, lancou: false }
        const r = await this.repo.add({
          tipo: 'transferencia',
          conta: 'transferência',
          valor: cmd.valor,
          remetente: msg.remetente,
          msgId: msg.msgId,
          data,
          enviadoEm: msg.enviadoEm,
          contaCorrenteId: origem.id,
          contaDestinoId: destino.id,
        })
        if (r === 'duplicado') return null
        return { texto: ui.transferenciaRegistrada({ origem: origem.nome, destino: destino.nome, valor: cmd.valor, dia: cmd.data ? data : undefined }), lancou: true }
      }
```

Em `desfazer`, antes de `const conta = ...`, trate a transferência:

```ts
        if (l?.tipo === 'transferencia') {
          const nomes = await this.contasCC.nomes()
          return { texto: ui.transferenciaDesfeita({ origem: nomes[l.contaCorrenteId] ?? '?', destino: nomes[l.contaDestinoId ?? ''] ?? '?', valor: l.valor }), lancou: false }
        }
```

Helper para buscar os nomes só quando a lista tem transferência (junto de `filtro`):

```ts
  // nomes das contas (id → nome) só quando há transferência na lista: evita a consulta nos relatórios sem elas
  private async nomesSeHouverTransferencia(ls: Lancamento[]): Promise<Record<string, string>> {
    return ls.some((l) => l.tipo === 'transferencia') ? this.contasCC.nomes() : {}
  }
```

`balanceteDoDia` e `extratoPagina` passam os nomes:

```ts
  private async balanceteDoDia(agora: Date, f: { id?: string; nome?: string }): Promise<string> {
    const extrato = await this.repo.extrato(intervaloDoDia(agora), f.id)
    return ui.balanceteDoDia(agora, extrato, somaTipo(extrato, 'receita'), somaTipo(extrato, 'despesa'), f.nome, await this.nomesSeHouverTransferencia(extrato))
  }
```

Em `extratoPagina`, depois de `const itens = todos.slice(...)`, e na chamada final:

```ts
    const nomes = await this.nomesSeHouverTransferencia(itens)
    return ui.extrato(pagina, total, itens, pagina === 1 ? { receitas: somaTipo(todos, 'receita'), despesas: somaTipo(todos, 'despesa') } : null, f.nome, nomes)
```

- [ ] **Step 5: Rodar até passar**

Run: `npm run typecheck && npx vitest run tests/service.test.ts tests/presentation.test.ts tests/parser.test.ts`
Expected: PASS. Se `tests/presentation.test.ts` comparar o texto literal da `AJUDA`, acrescente o bloco novo à expectativa (é a mudança pedida); qualquer outra falha é regressão: corrija o código, não o teste.

- [ ] **Step 6: README.** Na tabela de comandos, depois da linha de `/contas`, acrescente:

```markdown
| `/t 500 @nubank @itau` | transfere R$ 500 da conta `@nubank` para a `@itau` (o primeiro `@` é a origem). Com um `@` só (`/t 500 @itau`), sai da **favorita**. Data opcional no fim (`/t 500 @itau ontem`). Não é receita nem despesa: fora do balancete, da auditoria e do dashboard; aparece no extrato e muda o saldo das duas contas |
```

e, na seção "Contas correntes", acrescente ao final do parágrafo: "A transferência entre contas também pode ser desfeita com `/desfazer`; o saldo das duas contas volta."

- [ ] **Step 7: Suíte e commit**

Run: `npm run typecheck && npm test`
Expected: tudo verde.

```bash
git add src tests README.md
git commit -m "feat: /t transfere entre contas correntes (service, mensagens e desfazer)"
```
