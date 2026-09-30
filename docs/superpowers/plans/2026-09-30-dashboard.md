# Dashboard de indicadores financeiros — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela `/dashboard` com saldo/receitas/despesas do mês (com variação), tendência de 6 meses e despesas por categoria; usuário comum vê só a própria conta, o dev vê todas.

**Architecture:** `Repo` ganha `serieMensal`; `Repositorio` ganha `leitura(contaId | null)` (somente leitura, `null` = todas as contas). `src/dashboard.ts` (funções puras) calcula indicadores e o SVG de tendência; `paginas.ts` monta o HTML; `web.ts` decide de qual conta ler.

**Tech Stack:** TypeScript, Node http, `pg`, vitest. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-30-dashboard-design.md`

## Global Constraints

- Sem dependência nova; gráficos em SVG/HTML gerado no servidor (CSP `default-src 'self'; style-src 'unsafe-inline'` não muda).
- Nenhuma tabela nova; `lancamentos` com `desfeito_em IS NULL`.
- Usuário comum: sempre `conta.id` da sessão; `?conta=` só vale para o dev (`devEmail`). Admin comum = usuário comum aqui.
- Mês local com offset fixo -03:00 (`src/period.ts`); valores em centavos; formatação com `money.ts`.
- Tendência: 6 meses fixos, sem seletor. Categorias: 7 maiores + "Outras".
- A cor nunca é a única informação (receita = barra cheia, despesa = hachura, valores em texto, `role="img"` + `<title>`, tabela em `<details>`).
- Escapar (`esc`) todo texto vindo do usuário (nome de categoria, e-mail).
- Textos em pt-BR; comentários no estilo do repo (pt-BR, `ponytail:` para atalhos com teto conhecido).

## Desvios do spec (aplicados na Task 6, junto da documentação)
- `repoDe(null)` vira `repo.leitura(null)`: `Pick<Repo,'balancete'|'serieMensal'>`. Motivo: com `repoDe(null)`, `desfazerUltimo` poderia agir em todas as contas se alguém o chamasse por engano; o tipo de leitura impede isso.
- Categorias viram barras em HTML (`<ul>` + `div` com largura %) em vez de SVG: rótulos longos quebram melhor em HTML e o texto fica acessível de graça. Só a tendência é SVG.

## Review Focus

- Lançamento às 23:59 de 31/ago e 00:00 de 1/set (-03:00) cai no mês certo (Task 1, contrato `serieMensal`).
- Lançamento desfeito não entra na série (Task 1).
- Mês sem lançamentos aparece com 0, e o gráfico não gera `NaN`/divisão por zero (Tasks 1 e 2).
- Mês anterior zerado mostra "—", não `Infinity%` (Task 2).
- Nome de categoria com HTML (`<img onerror>`) sai escapado (Task 3).
- Usuário A forja `?conta=<id do B>` e continua vendo só o próprio (Task 4).
- Dev passa `?conta=` inexistente: cai em "Todas", sem erro 500 (Task 4).

---

### Task 0: Branch

- [ ] **Step 1:** A branch atual (`chore/remove-logs-tempo`) tem 1 commit à frente da `main` que não tem a ver com isso; partir da `main`. Os dois arquivos não rastreados de `docs/` (spec/plano da hospedagem) vão junto na troca e não devem ser commitados aqui.

```bash
git switch -c feat/dashboard main
git status --short
```
Expected: branch `feat/dashboard`; `?? docs/superpowers/specs/2026-09-30-dashboard-design.md`, `?? docs/superpowers/plans/2026-09-30-dashboard.md` e os dois arquivos da hospedagem.

---

### Task 1: `serieMensal` e `leitura` (dados)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/period.ts` (novo `mesesTerminandoEm`)
- Modify: `src/repo.ts`
- Modify: `tests/memoryRepo.ts`
- Test: `tests/period.test.ts`, `tests/repo.contract.ts`, `tests/pgRepo.test.ts`

**Interfaces:**
- Produces:
  - `type MesSerie = { ano: number; mes: number; receitas: number; despesas: number }` (em `types.ts`)
  - `Repo.serieMensal(ate: Date, meses: number): Promise<MesSerie[]>` — `meses` meses consecutivos terminando no mês local de `ate`, do mais antigo ao mais novo
  - `type Leitura = Pick<Repo, 'balancete' | 'serieMensal'>`
  - `Repositorio.leitura(contaId: string | null): Leitura` — `null` = todas as contas
  - `mesesTerminandoEm(ate: Date, n: number): { ano: number; mes: number }[]` (em `period.ts`)

- [ ] **Step 1: Teste de `mesesTerminandoEm`** — acrescentar em `tests/period.test.ts` (ajustar o import existente para incluir `mesesTerminandoEm`):

```ts
describe('mesesTerminandoEm', () => {
  it('lista n meses terminando no mês local, do mais antigo ao mais novo', () => {
    expect(mesesTerminandoEm(new Date('2026-09-30T12:00:00Z'), 3)).toEqual([
      { ano: 2026, mes: 7 },
      { ano: 2026, mes: 8 },
      { ano: 2026, mes: 9 },
    ])
  })
  it('atravessa a virada de ano', () => {
    expect(mesesTerminandoEm(new Date('2026-02-10T12:00:00Z'), 3)).toEqual([
      { ano: 2025, mes: 12 },
      { ano: 2026, mes: 1 },
      { ano: 2026, mes: 2 },
    ])
  })
  it('usa o mês local: 02:00Z de 1/out ainda é setembro em -03:00', () => {
    expect(mesesTerminandoEm(new Date('2026-10-01T02:00:00Z'), 1)).toEqual([{ ano: 2026, mes: 9 }])
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/period.test.ts` → FAIL (`mesesTerminandoEm` não existe).

- [ ] **Step 3: Implementar em `src/period.ts`** (logo após `mesAtual`):

```ts
// n meses consecutivos terminando no mês local de `ate`, do mais antigo ao mais novo
export function mesesTerminandoEm(ate: Date, n: number): { ano: number; mes: number }[] {
  const { ano, mes } = mesAtual(ate)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 1 - (n - 1 - i), 1)) // Date.UTC normaliza mês <= 0
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 }
  })
}
```
Run: `npx vitest run tests/period.test.ts` → PASS.

- [ ] **Step 4: Tipos em `src/types.ts`** — acrescentar `MesSerie`, o método em `Repo` e `Leitura`:

```ts
export type MesSerie = { ano: number; mes: number; receitas: number; despesas: number }
```
Dentro de `interface Repo`, depois de `balancete`:
```ts
  serieMensal(ate: Date, meses: number): Promise<MesSerie[]> // `meses` meses consecutivos terminando no mês local de `ate`, do mais antigo ao mais novo; meses sem lançamento vêm com 0; ignora desfeitos
```
Ao final do arquivo:
```ts
export type Leitura = Pick<Repo, 'balancete' | 'serieMensal'> // o que o dashboard lê; sem escrita
```

- [ ] **Step 5: Teste de contrato** — acrescentar dentro de `describe` em `tests/repo.contract.ts` (depois do teste de `balancete filtra por intervalo`):

```ts
    it('serieMensal soma por mês local, preenche meses vazios, ignora desfeitos e respeita a fronteira', async () => {
      const repo = await criar()
      await repo.add(novo({ tipo: 'receita', valor: 5000, data: new Date('2026-09-01T03:00:00Z') })) // 1/set 00:00 local
      await repo.add(novo({ valor: 1000, data: new Date('2026-09-01T02:59:59Z') })) // 31/ago 23:59 local
      await repo.add(novo({ valor: 300, data: new Date('2026-07-15T12:00:00Z') }))
      await repo.add(novo({ valor: 999, data: new Date('2026-07-16T12:00:00Z'), enviadoEm: new Date('2026-12-01T00:00:00Z') }))
      await repo.desfazerUltimo() // desfaz os 999 (maior enviadoEm)
      await repo.add(novo({ valor: 777, data: new Date('2026-10-01T03:00:00Z') })) // outubro: fora da janela
      expect(await repo.serieMensal(new Date('2026-09-30T12:00:00Z'), 3)).toEqual([
        { ano: 2026, mes: 7, receitas: 0, despesas: 300 },
        { ano: 2026, mes: 8, receitas: 0, despesas: 1000 },
        { ano: 2026, mes: 9, receitas: 5000, despesas: 0 },
      ])
    })

    it('serieMensal de conta sem lançamentos devolve todos os meses zerados', async () => {
      const repo = await criar()
      expect(await repo.serieMensal(new Date('2026-09-30T12:00:00Z'), 2)).toEqual([
        { ano: 2026, mes: 8, receitas: 0, despesas: 0 },
        { ano: 2026, mes: 9, receitas: 0, despesas: 0 },
      ])
    })
```
Run: `npx vitest run tests/memoryRepo.test.ts tests/pgRepo.test.ts` → FAIL (`serieMensal is not a function`). (Postgres precisa estar de pé: `docker compose up -d postgres`.)

- [ ] **Step 6: `MemoryRepo`** — em `tests/memoryRepo.ts` ajustar imports (`MesSerie`, `Natureza`, e `intervaloDoMes`, `mesesTerminandoEm` de `../src/period`) e acrescentar o método:

```ts
  async serieMensal(ate: Date, meses: number): Promise<MesSerie[]> {
    return mesesTerminandoEm(ate, meses).map(({ ano, mes }) => {
      const { de, ate: fim } = intervaloDoMes(ano, mes)
      const soma = (t: Natureza) =>
        this.itens
          .filter((i) => !i.desfeitoEm && i.tipo === t && i.data.getTime() >= de.getTime() && i.data.getTime() < fim.getTime())
          .reduce((s, i) => s + i.valor, 0)
      return { ano, mes, receitas: soma('receita'), despesas: soma('despesa') }
    })
  }
```

- [ ] **Step 7: `PgRepo`** em `src/repo.ts`:
  1. imports: `MesSerie`, `Leitura` de `./types`; `intervaloDoMes, mesesTerminandoEm` de `./period`.
  2. `constructor(private pool: Pool, private contaId: string | null)` com comentário: `// null = todas as contas; só as leituras (balancete, serieMensal) aceitam. add/desfazerUltimo/extrato continuam com "conta_id = $1", que com null não casa nada (e o tipo Leitura esconde a escrita).`
  3. Em `balancete`, trocar `WHERE conta_id = $1 AND desfeito_em IS NULL` por `WHERE ($1::text IS NULL OR conta_id = $1) AND desfeito_em IS NULL`.
  4. Novo método:

```ts
  async serieMensal(ate: Date, meses: number): Promise<MesSerie[]> {
    const lista = mesesTerminandoEm(ate, meses)
    const primeiro = lista[0]
    const ultimo = lista[lista.length - 1]
    // ponytail: -3 horas fixas = mesmo offset de period.ts (Brasil sem horário de verão desde 2019)
    const r = await this.pool.query<{ ano: number; mes: number; tipo: Natureza; total: string }>(
      `SELECT EXTRACT(YEAR FROM loc)::int AS ano, EXTRACT(MONTH FROM loc)::int AS mes, tipo, SUM(valor)::bigint AS total
       FROM (
         SELECT tipo, valor, (data AT TIME ZONE 'UTC') - interval '3 hours' AS loc FROM lancamentos
         WHERE ($1::text IS NULL OR conta_id = $1) AND desfeito_em IS NULL AND data >= $2 AND data < $3
       ) t
       GROUP BY 1, 2, tipo`,
      [this.contaId, intervaloDoMes(primeiro.ano, primeiro.mes).de, intervaloDoMes(ultimo.ano, ultimo.mes).ate],
    )
    const total = (ano: number, mes: number, tipo: Natureza) => Number(r.rows.find((x) => x.ano === ano && x.mes === mes && x.tipo === tipo)?.total ?? 0)
    return lista.map(({ ano, mes }) => ({ ano, mes, receitas: total(ano, mes, 'receita'), despesas: total(ano, mes, 'despesa') }))
  }
```
  5. No objeto retornado por `criarRepo`, acrescentar:
```ts
    leitura: (contaId: string | null) => new PgRepo(pool, contaId) as Leitura, // null = todas as contas (só o dev, no dashboard)
```

- [ ] **Step 8: Teste de `leitura(null)`** — acrescentar em `tests/pgRepo.test.ts`:

```ts
it('leitura(null) soma todas as contas; leitura(id) só a própria', async () => {
  const { repoDe, leitura } = await abrir()
  const l = (msgId: string, valor: number) => ({ tipo: 'despesa' as const, conta: 'x', valor, remetente: 'u', msgId, data: new Date('2026-09-10T12:00:00Z'), enviadoEm: new Date() })
  await repoDe('a').add(l('m1', 100))
  await repoDe('b').add(l('m1', 250))
  expect((await leitura(null).balancete(null)).despesas).toEqual([{ conta: 'x', total: 350 }])
  expect((await leitura('a').balancete(null)).despesas).toEqual([{ conta: 'x', total: 100 }])
  const serie = await leitura(null).serieMensal(new Date('2026-09-30T12:00:00Z'), 1)
  expect(serie).toEqual([{ ano: 2026, mes: 9, receitas: 0, despesas: 350 }])
})
```

- [ ] **Step 9:** `npx vitest run tests/period.test.ts tests/memoryRepo.test.ts tests/pgRepo.test.ts && npm run typecheck` → PASS. Se `typecheck` acusar mocks de `Repo` em outros testes sem `serieMensal`, acrescentar `serieMensal: async () => []` neles.

- [ ] **Step 10: Commit**
```bash
git add src/types.ts src/period.ts src/repo.ts tests/
git commit -m "feat: serieMensal e leitura(contaId|null) no repositório"
```

---

### Task 2: Indicadores e gráfico de tendência (`src/dashboard.ts`)

**Files:**
- Create: `src/dashboard.ts`
- Test: `tests/dashboard.test.ts`

**Interfaces:**
- Consumes: `MesSerie`, `Balancete` (`types.ts`); `formatValor` (`money.ts`).
- Produces:
  - `type Categoria = { conta: string; total: number; largura: number }` (`largura` = % da maior, 0–100)
  - `type Indicadores = { mes: MesSerie; saldo: number; variacao: { saldo: number | null; receitas: number | null; despesas: number | null }; categorias: Categoria[]; serie: MesSerie[]; vazio: boolean }` (`variacao` em % inteiro; `null` = mês anterior zerado)
  - `montarIndicadores(serie: MesSerie[], balanceteMes: Balancete): Indicadores` (`serie` não vazia, último = mês atual)
  - `svgTendencia(serie: MesSerie[]): string`
  - `rotuloMesCurto(m: { mes: number }): string` (`'set'`)

- [ ] **Step 1: Testes** — criar `tests/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { montarIndicadores, svgTendencia } from '../src/dashboard'
import type { MesSerie } from '../src/types'

const m = (mes: number, receitas: number, despesas: number): MesSerie => ({ ano: 2026, mes, receitas, despesas })
const vazio = { receitas: [], despesas: [] }

describe('montarIndicadores', () => {
  it('calcula saldo e variação % sobre o mês anterior', () => {
    const i = montarIndicadores([m(8, 1000, 500), m(9, 1500, 250)], vazio)
    expect(i.saldo).toBe(1250)
    expect(i.variacao).toEqual({ saldo: 150, receitas: 50, despesas: -50 }) // saldo: 500 -> 1250
  })

  it('mês anterior zerado vira null (nunca Infinity)', () => {
    const i = montarIndicadores([m(8, 0, 0), m(9, 1000, 200)], vazio)
    expect(i.variacao).toEqual({ saldo: null, receitas: null, despesas: null })
  })

  it('série de um mês só não quebra', () => {
    expect(montarIndicadores([m(9, 1000, 200)], vazio).variacao.receitas).toBeNull()
  })

  it('agrupa da 8ª categoria em diante em "Outras" e escala a largura pela maior', () => {
    const despesas = Array.from({ length: 9 }, (_, k) => ({ conta: `c${k}`, total: (9 - k) * 100 })) // 900..100
    const i = montarIndicadores([m(9, 0, 4500)], { receitas: [], despesas })
    expect(i.categorias).toHaveLength(8)
    expect(i.categorias[0]).toEqual({ conta: 'c0', total: 900, largura: 100 })
    expect(i.categorias[7]).toEqual({ conta: 'Outras', total: 300, largura: 33 }) // 200 + 100
  })

  it('vazio = nenhum lançamento em toda a janela', () => {
    expect(montarIndicadores([m(8, 0, 0), m(9, 0, 0)], vazio).vazio).toBe(true)
    expect(montarIndicadores([m(8, 0, 10), m(9, 0, 0)], vazio).vazio).toBe(false)
  })
})

describe('svgTendencia', () => {
  it('desenha um rótulo por mês, é acessível e não gera NaN com tudo zerado', () => {
    const svg = svgTendencia([m(4, 0, 0), m(5, 0, 0), m(6, 0, 0), m(7, 0, 0), m(8, 0, 0), m(9, 0, 0)])
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title')
    expect(svg).not.toContain('NaN')
    for (const r of ['abr', 'mai', 'jun', 'jul', 'ago', 'set']) expect(svg).toContain(`>${r}<`)
  })

  it('mostra o valor de cada barra em texto (cor não é a única informação)', () => {
    const svg = svgTendencia([m(9, 123400, 5600)])
    expect(svg).toContain('1,2k')
    expect(svg).toContain('56')
  })
})
```
Run: `npx vitest run tests/dashboard.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar `src/dashboard.ts`:**

```ts
import type { Balancete, MesSerie } from './types'

export type Categoria = { conta: string; total: number; largura: number }
export type Indicadores = {
  mes: MesSerie
  saldo: number
  variacao: { saldo: number | null; receitas: number | null; despesas: number | null } // % inteiro; null = mês anterior zerado
  categorias: Categoria[]
  serie: MesSerie[]
  vazio: boolean
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const rotuloMesCurto = (m: { mes: number }) => MESES[m.mes - 1]

const MAX_CATEGORIAS = 7
const pct = (atual: number, anterior: number) => (anterior === 0 ? null : Math.round(((atual - anterior) / Math.abs(anterior)) * 100))

export function montarIndicadores(serie: MesSerie[], balanceteMes: Balancete): Indicadores {
  const mes = serie[serie.length - 1]
  const ant = serie[serie.length - 2] ?? { ...mes, receitas: 0, despesas: 0 }
  const saldo = mes.receitas - mes.despesas
  const top = balanceteMes.despesas.slice(0, MAX_CATEGORIAS)
  const resto = balanceteMes.despesas.slice(MAX_CATEGORIAS).reduce((s, l) => s + l.total, 0)
  const linhas = resto > 0 ? [...top, { conta: 'Outras', total: resto }] : top
  const maior = Math.max(1, ...linhas.map((l) => l.total))
  return {
    mes,
    saldo,
    variacao: {
      saldo: pct(saldo, ant.receitas - ant.despesas),
      receitas: pct(mes.receitas, ant.receitas),
      despesas: pct(mes.despesas, ant.despesas),
    },
    categorias: linhas.map((l) => ({ ...l, largura: Math.round((l.total / maior) * 100) })),
    serie,
    vazio: serie.every((s) => s.receitas === 0 && s.despesas === 0),
  }
}

// 1234500 centavos -> "12,3k"; 5600 -> "56"
const curto = (centavos: number) => {
  const reais = Math.round(centavos / 100)
  return reais >= 1000 ? `${(reais / 1000).toFixed(1).replace('.', ',')}k` : String(reais)
}

// Barras agrupadas receita (cheia) × despesa (hachurada). Cores vêm de classes/variáveis CSS da página.
export function svgTendencia(serie: MesSerie[]): string {
  const W = 360, H = 220, topo = 22, base = H - 26, alt = base - topo
  const passo = W / serie.length
  const max = Math.max(1, ...serie.flatMap((s) => [s.receitas, s.despesas]))
  const barra = (x: number, v: number, classe: string) => {
    const h = Math.round((v / max) * alt)
    return `<rect class="${classe}" x="${x}" y="${base - h}" width="24" height="${h}" rx="3"/><text class="val" x="${x + 12}" y="${base - h - 4}" text-anchor="middle">${curto(v)}</text>`
  }
  const grupos = serie
    .map((s, i) => {
      const x = Math.round(i * passo + passo / 2 - 26)
      return `${barra(x, s.receitas, 'b-rec')}${barra(x + 28, s.despesas, 'b-desp')}<text class="eixo" x="${x + 26}" y="${H - 8}" text-anchor="middle">${rotuloMesCurto(s)}</text>`
    })
    .join('')
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-tend"><title id="t-tend">Receitas e despesas dos últimos ${serie.length} meses, em reais</title><defs><pattern id="hachura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="h-fundo"/><line x1="0" y1="0" x2="0" y2="6" class="h-traco"/></pattern></defs><line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>${grupos}</svg>`
}
```
(Com 6 meses: `passo` = 60, cada grupo ocupa 52px centrados.)

- [ ] **Step 3:** `npx vitest run tests/dashboard.test.ts && npm run typecheck` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/dashboard.ts tests/dashboard.test.ts
git commit -m "feat: indicadores e gráfico de tendência do dashboard"
```

---

### Task 3: Página do dashboard (`paginas.ts`)

**Design:** usar o UI UX Pro Max só para o que é dele (decisões visuais: paleta/contraste, tipo de gráfico, acessibilidade). Ele já foi consultado; o resultado está na seção "Visual e acessibilidade" do spec. Não gerar arquivos `design-system/` nem trazer fonte externa (CSP).

**Files:**
- Modify: `src/paginas.ts` (variáveis CSS, regras CSS, ícones, `paginaDashboard`, link no painel)
- Test: `tests/paginas.test.ts`

**Interfaces:**
- Consumes: `Indicadores`, `svgTendencia`, `rotuloMesCurto` (Task 2); `formatBRL` (`money.ts`); `esc`, `layout`, `marca`, `ic` (já em `paginas.ts`).
- Produces: `paginaDashboard(email: string, ind: Indicadores, admin: boolean, dev?: { contas: { id: string; email: string }[]; selecionada: string | null }): string`

- [ ] **Step 1: Testes** — em `tests/paginas.test.ts`, importar `paginaDashboard` e `montarIndicadores` e acrescentar:

```ts
import { montarIndicadores } from '../src/dashboard'
import type { MesSerie } from '../src/types'

describe('paginaDashboard', () => {
  const serie: MesSerie[] = [
    { ano: 2026, mes: 8, receitas: 100000, despesas: 50000 },
    { ano: 2026, mes: 9, receitas: 150000, despesas: 25000 },
  ]
  const ind = (despesas = [{ conta: 'mercado', total: 25000 }]) => montarIndicadores(serie, { receitas: [], despesas })

  it('mostra os cartões, o gráfico, as categorias e a tabela alternativa', () => {
    const html = paginaDashboard('ana@x.com', ind(), false)
    expect(html).toContain('R$ 1.250,00') // saldo
    expect(html).toContain('+50%')
    expect(html).toContain('role="img"')
    expect(html).toContain('mercado')
    expect(html).toContain('<details')
    expect(html).toContain('href="/painel"')
  })

  it('escapa nome de categoria vindo do usuário', () => {
    const html = paginaDashboard('ana@x.com', ind([{ conta: '<img src=x onerror=alert(1)>', total: 100 }]), false)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('sem lançamentos mostra orientação em vez de gráficos', () => {
    const zerado = montarIndicadores([{ ano: 2026, mes: 9, receitas: 0, despesas: 0 }], { receitas: [], despesas: [] })
    const html = paginaDashboard('ana@x.com', zerado, false)
    expect(html).toContain('Nenhum lançamento')
    expect(html).not.toContain('role="img"')
  })

  it('seletor de contas só aparece para o dev, com a atual marcada', () => {
    expect(paginaDashboard('ana@x.com', ind(), false)).not.toContain('<select')
    const html = paginaDashboard('dev@x.com', ind(), true, { contas: [{ id: 'c1', email: 'a@x.com' }, { id: 'c2', email: 'b@x.com' }], selecionada: 'c2' })
    expect(html).toContain('<select')
    expect(html).toContain('value="c2" selected')
    expect(html).toContain('Todas as contas')
  })

  it('o painel ganha o link para o dashboard', () => {
    expect(paginaPainel('ana@x.com', '', 'conectar')).toContain('href="/dashboard"')
  })
})
```
Run: `npx vitest run tests/paginas.test.ts` → FAIL.

- [ ] **Step 2: Variáveis e CSS** em `ESTILO` (`src/paginas.ts`):
  - No `:root` claro, antes de `--sombra:0 1px`: `--receita:#0f7a43;--despesa:#b45309;`
  - No `:root` escuro (dentro do `@media (prefers-color-scheme:dark)`), antes de `--sombra:none`: `--receita:#4ade80;--despesa:#fbbf24;`
  - Antes da linha `@media (max-width:420px)` (linha ~94 no início desta tarefa), acrescentar:

```css
/* dashboard */
.dash{display:grid;gap:16px}
.kpis{display:grid;gap:12px;grid-template-columns:1fr}
.kpi{background:var(--cartao);border:1px solid var(--borda);border-radius:14px;padding:16px;box-shadow:var(--sombra)}
.kpi .rot{color:var(--suave);font-size:.9rem}.kpi .num{font-size:1.6rem;font-weight:700;letter-spacing:-.01em}
.var{display:inline-flex;align-items:center;gap:4px;font-size:.88rem;font-weight:600}.var.bom{color:var(--receita)}.var.ruim{color:var(--erro)}.var.neutro{color:var(--suave)}
.grafico{display:block;width:100%;max-width:560px;height:auto}
.grafico .b-rec{fill:var(--receita)}.grafico .b-desp{fill:url(#hachura);stroke:var(--despesa);stroke-width:1.5}
.grafico .h-fundo{fill:var(--cartao)}.grafico .h-traco{stroke:var(--despesa);stroke-width:3}
.grafico .val,.grafico .eixo{fill:var(--texto);font-size:10px}.grafico .eixo{fill:var(--suave);font-size:11px}.grafico .base{stroke:var(--borda)}
.legenda{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 0;padding:0;list-style:none;font-size:.88rem;color:var(--suave)}
.legenda i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}.legenda .l-rec{background:var(--receita)}.legenda .l-desp{border:1.5px solid var(--despesa);background:repeating-linear-gradient(45deg,var(--despesa) 0 2px,transparent 2px 5px)}
.cats{list-style:none;margin:0;padding:0;display:grid;gap:12px}.cats li{display:grid;grid-template-columns:1fr auto;gap:2px 12px}.cats .nome{overflow-wrap:anywhere}.cats .valor{font-variant-numeric:tabular-nums;font-weight:600}
.trilho{grid-column:1/-1;height:8px;background:var(--borda);border-radius:99px;overflow:hidden}.trilho div{height:100%;background:var(--despesa);border-radius:99px}
.dash details{margin-top:12px;font-size:.9rem}.dash summary{cursor:pointer;color:var(--suave)}.dash table{width:100%;border-collapse:collapse;margin-top:8px}.dash th,.dash td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--borda)}.dash th:first-child,.dash td:first-child{text-align:left}
.filtro{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (min-width:640px){.kpis{grid-template-columns:repeat(3,1fr)}}
```

- [ ] **Step 3: Ícones** — em `ICONES` (antes do `}` que fecha o objeto, perto de `troca:`), acrescentar:
```ts
  cima: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  baixo: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
```

- [ ] **Step 4: `paginaDashboard`** — acrescentar em `src/paginas.ts` após `paginaPainel` (e importar `Indicadores, svgTendencia, rotuloMesCurto` de `./dashboard` e `formatBRL` de `./money` no topo):

```ts
// --- dashboard -----------------------------------------------------------

const nomeMes = (ano: number, mes: number) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(ano, mes - 1, 1)))

// subir receita/saldo é bom; subir despesa não é
const variacao = (v: number | null, altaEhBoa: boolean) => {
  if (v === null) return '<span class="var neutro">— sem mês anterior para comparar</span>'
  if (v === 0) return '<span class="var neutro">0% vs. mês anterior</span>'
  const bom = (v > 0) === altaEhBoa
  return `<span class="var ${bom ? 'bom' : 'ruim'}">${ic(v > 0 ? 'cima' : 'baixo')}${v > 0 ? '+' : ''}${v}% vs. mês anterior</span>`
}

const kpi = (rotulo: string, valor: number, v: number | null, altaEhBoa: boolean) =>
  `<div class="kpi"><div class="rot">${rotulo}</div><div class="num">${formatBRL(valor)}</div>${variacao(v, altaEhBoa)}</div>`

export const paginaDashboard = (
  email: string,
  ind: Indicadores,
  admin: boolean,
  dev?: { contas: { id: string; email: string }[]; selecionada: string | null },
) => {
  const seletor = dev
    ? `<form class="filtro" method="get" action="/dashboard"><label for="conta">Conta</label><select id="conta" name="conta"><option value="">Todas as contas</option>${dev.contas.map((c) => `<option value="${esc(c.id)}"${c.id === dev.selecionada ? ' selected' : ''}>${esc(c.email)}</option>`).join('')}</select><button class="btn sec pequeno">Ver</button></form>`
    : ''
  const corpo = ind.vazio
    ? '<div class="cartao"><p>Nenhum lançamento nos últimos 6 meses. Registre uma despesa ou receita no grupo do WhatsApp e ela aparece aqui.</p></div>'
    : `<div class="kpis">${kpi('Saldo do mês', ind.saldo, ind.variacao.saldo, true)}${kpi('Receitas', ind.mes.receitas, ind.variacao.receitas, true)}${kpi('Despesas', ind.mes.despesas, ind.variacao.despesas, false)}</div>
<section class="cartao"><h2>Últimos ${ind.serie.length} meses</h2>${svgTendencia(ind.serie)}<ul class="legenda"><li><i class="l-rec"></i>Receitas</li><li><i class="l-desp"></i>Despesas</li></ul>
<details><summary>Ver dados em tabela</summary><table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th></tr></thead><tbody>${ind.serie.map((s) => `<tr><td>${rotuloMesCurto(s)}/${s.ano}</td><td>${formatBRL(s.receitas)}</td><td>${formatBRL(s.despesas)}</td></tr>`).join('')}</tbody></table></details></section>
<section class="cartao"><h2>Despesas por categoria</h2>${ind.categorias.length ? `<ul class="cats">${ind.categorias.map((c) => `<li><span class="nome">${esc(c.conta)}</span><span class="valor">${formatBRL(c.total)}</span><div class="trilho" aria-hidden="true"><div style="width:${c.largura}%"></div></div></li>`).join('')}</ul>` : '<p class="sub">Sem despesas neste mês.</p>'}</section>`
  return layout(
    'Dashboard',
    `<div class="pagina"><header class="topo">${marca('/painel')}<div class="usuario"><a class="link-admin" href="/painel">Painel</a>${admin ? '<a class="link-admin" href="/admin">Administração</a>' : ''}<span class="email" title="${esc(email)}">${esc(email)}</span><form method="post" action="/sair"><button class="btn sec pequeno">${ic('sair')}Sair</button></form></div></header><main id="conteudo" class="dash"><div><h1>Dashboard</h1><p class="sub">${nomeMes(ind.mes.ano, ind.mes.mes)}</p></div>${seletor}${corpo}</main></div>`,
  )
}
```

- [ ] **Step 5: Link no painel** — em `paginaPainel`, trocar `${admin ? '<a class="link-admin" href="/admin">Administração</a>' : ''}` por `<a class="link-admin" href="/dashboard">Dashboard</a>${admin ? '<a class="link-admin" href="/admin">Administração</a>' : ''}`.

- [ ] **Step 6:** `npx vitest run tests/paginas.test.ts && npm run typecheck` → PASS. Se algum teste antigo do painel comparar o cabeçalho exato, ajustar só a expectativa do link novo.

- [ ] **Step 7: Commit**
```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: página do dashboard e link no painel"
```

---

### Task 4: Rota `/dashboard` e controle de acesso

**Files:**
- Modify: `src/web.ts`
- Test: `tests/web.test.ts`

**Interfaces:**
- Consumes: `Repositorio.leitura` (Task 1), `montarIndicadores` (Task 2), `paginaDashboard` (Task 3), `mesAtual`/`intervaloDoMes` (`period.ts`), `contas.listarContas()`.
- Produces: `GET /dashboard`.

- [ ] **Step 1: Testes** — em `tests/web.test.ts`:
  1. No `repoFalso` (em `beforeAll`), acrescentar `leitura` e ajustar o tipo declarado (`let repoFalso: { repoDe: ...; apagarConta: ...; leitura: ReturnType<typeof vi.fn> }`):
```ts
  repoFalso = {
    repoDe: vi.fn(),
    apagarConta: vi.fn(async (_id: string) => {}),
    leitura: vi.fn((_id: string | null) => ({
      serieMensal: async () => [{ ano: 2026, mes: 9, receitas: 123400, despesas: 5600 }],
      balancete: async () => ({ receitas: [], despesas: [{ conta: 'mercado-teste', total: 5600 }] }),
    })),
  }
```
  (Os outros blocos que criam `repoFalso` próprio — linhas ~473 e ~505 — não precisam de `leitura`.)
  2. Novo `describe` ao final do arquivo:
```ts
describe('GET /dashboard', () => {
  it('sem login redireciona para /entrar', async () => {
    const r = await get('/dashboard')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/entrar')
  })

  it('usuário comum lê só a própria conta, mesmo forjando ?conta=', async () => {
    const a = await entrar()
    const b = await entrar()
    const r = await get(`/dashboard?conta=${b.conta.id}`, a.cookie)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('mercado-teste')
    expect(html).not.toContain('<select')
    expect(repoFalso.leitura).toHaveBeenCalledTimes(1)
    expect(repoFalso.leitura).toHaveBeenCalledWith(a.conta.id)
  })

  it('admin comum não vê outras contas', async () => {
    const cookie = await entrarComo(EMAIL_ADMIN, 'senha-boa-123')
    const html = await (await get('/dashboard', cookie)).text()
    expect(html).not.toContain('<select')
    expect(repoFalso.leitura).not.toHaveBeenCalledWith(null)
  })

  it('dev vê todas por padrão, escolhe uma conta e ignora id inexistente', async () => {
    const cookieDev = await entrarComo(EMAIL_DEV, 'senha-dev-123')
    const alvo = await entrar()
    const padrao = await (await get('/dashboard', cookieDev)).text()
    expect(padrao).toContain('<select')
    expect(repoFalso.leitura).toHaveBeenLastCalledWith(null)
    expect(padrao).toContain(alvo.conta.email)
    await get(`/dashboard?conta=${alvo.conta.id}`, cookieDev)
    expect(repoFalso.leitura).toHaveBeenLastCalledWith(alvo.conta.id)
    const r = await get('/dashboard?conta=nao-existe', cookieDev)
    expect(r.status).toBe(200)
    expect(repoFalso.leitura).toHaveBeenLastCalledWith(null)
  })
})
```
Run: `npx vitest run tests/web.test.ts -t "GET /dashboard"` → FAIL (404).

- [ ] **Step 2: Rota** em `src/web.ts`:
  - Imports: `ContaResumo` no import de `./contas` (`import { criarLimitador, type Conta, type ContaResumo, type Contas, type ErroCadastro } from './contas'`), `paginaDashboard` no import de `./paginas`, e novas linhas:
```ts
import { montarIndicadores } from './dashboard'
import { intervaloDoMes, mesAtual } from './period'
```
  - Dentro do bloco `if (metodo === 'GET')`, logo antes do `if (caminho === '/admin')`:
```ts
      if (caminho === '/dashboard') {
        if (!conta) return ir(res, '/entrar')
        const dev = conta.email === op.devEmail
        // usuário comum: sempre a própria conta (?conta= é ignorado). Só o dev escolhe; id desconhecido = todas.
        let alvo: string | null = conta.id
        let lista: ContaResumo[] = []
        if (dev) {
          lista = await contas.listarContas()
          const pedido = url.searchParams.get('conta') ?? ''
          alvo = lista.some((c) => c.id === pedido) ? pedido : null
        }
        const agora = new Date()
        const { ano, mes } = mesAtual(agora)
        const leitura = op.repo.leitura(alvo)
        const [serie, balancete] = await Promise.all([leitura.serieMensal(agora, 6), leitura.balancete(intervaloDoMes(ano, mes))])
        return html(res, 200, paginaDashboard(conta.email, montarIndicadores(serie, balancete), isAdmin(conta.email), dev ? { contas: lista, selecionada: alvo } : undefined))
      }
```
  - Atualizar o comentário de `repo` em `OpcoesWeb`: `// apaga o histórico ao excluir conta e fornece as leituras do dashboard`.

- [ ] **Step 3:** `npx vitest run tests/web.test.ts && npm run typecheck` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/web.ts tests/web.test.ts
git commit -m "feat: rota /dashboard com acesso por conta e visão total só para o dev"
```

---

### Task 5: Verificação no app real

**Files:** nenhum (só verificação; usar a skill `run` se o app não estiver de pé).

- [ ] **Step 1:** `npm test && npm run typecheck` → tudo verde (Postgres de pé).

- [ ] **Step 2:** Subir o app (`npm start`, já configurado; Postgres em `docker compose up -d postgres`). Criar dados de exemplo via `psql` no banco de desenvolvimento **só se o usuário autorizar**; caso contrário, validar só o estado vazio.
  - Logar como o usuário e abrir `http://localhost:3000/dashboard`: estado vazio ou com dados, em largura de celular (~375px) e desktop, tema claro e escuro, sem scroll horizontal.
  - Conferir na tela: cartões, barras com valores legíveis, hachura visível nas despesas, tabela em `<details>`, link Painel ↔ Dashboard.
  - Se houver `DEV_EMAIL`, logar como dev e checar o seletor.

- [ ] **Step 3:** Se algo estiver ilegível (rótulos de valor sobrepostos no gráfico, contraste), ajustar o CSS da Task 3 e repetir.

---

### Task 6: Documentação e fechamento

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-30-dashboard-design.md`

- [ ] **Step 1:** README: acrescentar na seção "Portal (SaaS)" um parágrafo curto: "**Dashboard:** `/dashboard` mostra saldo, receitas e despesas do mês (com variação), a tendência de 6 meses e as despesas por categoria, só da própria conta. A conta DEV (`DEV_EMAIL`) vê todas as contas somadas ou escolhe uma."

- [ ] **Step 2:** Spec: nas seções "Dados" e "Código", trocar `repoDe(null)` por `repo.leitura(null)` (tipo `Leitura`, só leitura) e "categorias em SVG" por "categorias em HTML (barras por largura %)", com uma linha do motivo.

- [ ] **Step 3: Commit e fechamento**
```bash
git add README.md docs/superpowers/specs/2026-09-30-dashboard-design.md docs/superpowers/plans/2026-09-30-dashboard.md
git commit -m "docs: dashboard no README, spec ajustado e plano"
```
Depois, invocar `superpowers:finishing-a-development-branch`.
