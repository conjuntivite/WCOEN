# Resumos (mensal/semanal/anual) e balancete do dia — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Corrigir o desenho dos relatórios: `balancete mensal|semanal|anual` passam a mostrar **só o resumo** (receitas, despesas e saldo de cada período), sem extrato; e `balancete` sozinho mostra o **extrato do dia** (data, hora, valor e descrição de cada movimento de hoje, com o total do dia).

**Architecture:** Mudança pontual em `src/parser.ts`, `src/service.ts` e `src/period.ts`; nada muda no repositório, na auditoria nem no adaptador do WhatsApp.

**Tech Stack:** o mesmo do projeto (Node + TypeScript, Vitest, MongoDB).

## Decisões do usuário (vinculantes)

- `balancete semanal`/`mensal`/`anual`: **apenas** receita, despesa e saldo do período atual e dos anteriores. **Sem extrato** (sem data/hora/valor de cada lançamento).
- `balancete` (sozinho): o extrato **do dia** (movimento de hoje) com data, hora, valor e descrição, e o total do dia.
- Janelas: **12 meses**, **4 semanas** (domingo a sábado, a atual incluída), **5 anos**, sempre com a atual primeiro e **sem os períodos sem movimento**.
- O anual deixa de ter o bloco "Por mês": é só o resumo dos últimos 5 anos.
- A `auditoria` não muda.

## Global Constraints

- Valores em centavos inteiros; formatar com `formatBRL` (de `src/money.ts`), **com "R$"** (nos resumos o "R$" volta, porque agora é o conteúdo principal).
- Fuso -03:00 fixo (como em `src/period.ts`).
- Respostas começam com emoji, usam `*negrito*`, blocos separados por linha em branco, e cada valor com o ícone **na mesma linha** (um item por linha: `🟢 R$ …`, `🔴 R$ …`, `💰 R$ …`), para não quebrar no celular.
- Mensagens recuperadas (`recuperada: true`) continuam devolvendo `null` para `balancete` e uso incorreto.
- Commit termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (segundo `-m`).

---

### Task 1: Resumos sem extrato e balancete do dia

**Files:**
- Modify: `src/period.ts`, `src/parser.ts`, `src/service.ts`, `tests/period.test.ts`, `tests/parser.test.ts`, `tests/service.test.ts`

**Interfaces:**
- `src/period.ts`: novo `intervaloDoDia(agora: Date): { de: Date; ate: Date }` — o dia local (-03:00) que contém `agora`: de 00:00 local a 00:00 local seguinte (`ate` exclusivo). Testes: `2026-09-15T12:00:00Z` → `de = 2026-09-15T03:00:00.000Z`, `ate = 2026-09-16T03:00:00.000Z`; `2026-09-15T02:59:00Z` (ainda dia 14 local) → `de = 2026-09-14T03:00:00.000Z`; `2026-09-15T03:00:00Z` → `de = 2026-09-15T03:00:00.000Z`; virada de mês (`2026-10-01T12:00:00Z` → `ate = 2026-10-02T03:00:00.000Z`) e de ano (`2026-12-31T12:00:00Z` → `ate = 2027-01-01T03:00:00.000Z`).
- `src/parser.ts`: `Comando` passa a ter `{ tipo: 'balancete'; relatorio: 'hoje' | Relatorio }` (mantém `Relatorio = 'mensal' | 'semanal' | 'anual'`, que a auditoria continua usando). Regras: `balancete` e `balancete hoje` → `hoje`; `balancete mensal|semanal|anual` → o respectivo; qualquer outro texto depois de `balancete` → `{ tipo: 'uso', comando: 'balancete' }`. Sem diferenciar maiúsculas, tolerando espaços extras. `auditoria` **não muda** (`auditoria` = `auditoria mensal`).
- `src/service.ts`: o texto de uso de `balancete` vira exatamente `⚠️ Use *balancete*, *balancete mensal*, *balancete semanal* ou *balancete anual*.`; a seção `📊 *Consultar*` do `ajuda` passa a listar `• balancete → movimentos de hoje` e `• balancete mensal · semanal · anual → resumo` (mantendo a linha de `auditoria`).

**Formato exato (golden strings).** Todos os exemplos usam `agora = 2026-09-15T12:00:00Z` (terça).

`balancete mensal`, com `+ salário 3000` (enviado `2026-09-05T12:00:00Z`), `mercado 345,90` (`2026-09-10T15:30:00Z`), `luz 166,50` (`2026-09-12T18:05:00Z`), `mercado 10` (`2026-08-31T12:00:00Z`):

```
📊 *Balancete mensal*

*09/2026*
🟢 R$ 3.000,00
🔴 R$ 512,40
💰 R$ 2.487,60

*08/2026*
🟢 R$ 0,00
🔴 R$ 10,00
💰 -R$ 10,00
```

`balancete semanal`, com `mercado 10` (`2026-09-14T12:00:00Z`), `luz 20` (`2026-09-12T12:00:00Z`), `gas 30` (`2026-08-31T12:00:00Z`) — a semana atual é 13/09 a 19/09 e a de 23/08 a 29/08 não tem movimento:

```
📊 *Balancete semanal*

*13/09 a 19/09*
🟢 R$ 0,00
🔴 R$ 10,00
💰 -R$ 10,00

*06/09 a 12/09*
🟢 R$ 0,00
🔴 R$ 20,00
💰 -R$ 20,00

*30/08 a 05/09*
🟢 R$ 0,00
🔴 R$ 30,00
💰 -R$ 30,00
```

`balancete anual`, com `+ salário 3000` (`2026-09-05T12:00:00Z`), `mercado 345,90` (`2026-09-10T15:30:00Z`), `luz 166,50` (`2026-09-12T18:05:00Z`), `mercado 10` (`2025-12-31T12:00:00Z`), `gas 5` (`2021-03-10T12:00:00Z`, fora dos 5 anos):

```
📊 *Balancete anual*

*2026*
🟢 R$ 3.000,00
🔴 R$ 512,40
💰 R$ 2.487,60

*2025*
🟢 R$ 0,00
🔴 R$ 10,00
💰 -R$ 10,00
```

`balancete` (dia), com `mercado 45,90` (enviado `2026-09-15T12:30:00Z`), `+ plantão 450` (`2026-09-15T15:05:00Z`) e `luz 20` (`2026-09-14T12:00:00Z`, ontem, não entra):

```
📊 *Balancete · hoje 15/09*

*15/09 às 09:30*
🔴 R$ 45,90 · mercado
*15/09 às 12:05*
🟢 R$ 450,00 · plantão

🟢 *Receitas* — R$ 450,00
🔴 *Despesas* — R$ 45,90
💰 *Saldo: R$ 404,10*
```
(data em cima do lançamento é a `data` do lançamento; a hora é a do **envio**; ordem por `data`, depois `enviadoEm`, depois inserção — a que `repo.extrato` já devolve.)

Regras:
- **Resumos:** um bloco por período com movimento, do mais recente ao mais antigo, separados por **linha em branco**; usa `repo.balancete(intervalo)` por período (somas por conta, somadas). Janelas e rótulos como já estão implementados em `periodos(rel)` (12 meses `MM/AAAA`, 4 semanas `dd/mm a dd/mm` domingo a sábado, 5 anos `AAAA`); período sem movimento não aparece; **nenhum** extrato, nenhuma linha por lançamento e nenhum bloco "Por mês". Nenhum movimento em nenhum período: `📊 *Balancete mensal*\n\nSem lançamentos no período.` (idem semanal/anual).
- **Balancete do dia:** usa `repo.extrato(intervaloDoDia(agora))`; cabeçalho `📊 *Balancete · hoje dd/mm*`; sem lançamentos hoje: `📊 *Balancete · hoje 15/09*\n\nSem lançamentos hoje.`; desfeitos nunca aparecem.
- A `auditoria` continua usando `periodos(rel)` (título, período atual, janela): não a quebre; remova de `periodos` só o que ficar sem uso (`cabExtrato`, `vazio`, `cabResumo`) e o código morto do extrato/“Por mês” que ficar sem uso no balancete.
- Testes: reescreva os testes de `balancete mensal|semanal|anual` (goldens acima, `toBe` na string inteira), mantendo os casos já existentes que continuam válidos (janela de 12 meses, virada de ano, só períodos com movimento, desfeito some, retroativo entra no período da sua `data`, uso incorreto, `recuperada`, anti-eco no parser); acrescente os do balancete do dia (ordenação, ontem fora, virada 02:59Z/03:00Z, vazio, `balancete hoje`, desfeito some, retroativo `+ plantão 450 01/09` **não** aparece no dia de hoje).
- Parser: `balancete` → `hoje`; `balancete mensal|semanal|anual`; `balancete hoje`; maiúsculas/espaços; usos incorretos (`balancete trimestre`, `balancete mercado`, `balancete 2025`); as respostas novas nunca viram comando (as linhas `*15/09 às 09:30*`, `🔴 R$ 45,90 · mercado`, `*09/2026*`, `🟢 R$ 3.000,00`, `📊 *Balancete · hoje 15/09*`).

- [ ] **Step 1:** Escreva os testes (period, parser, service) e veja falhar.
- [ ] **Step 2:** Implemente até passar. `npm run typecheck` e `npm test` verdes, saída limpa.
- [ ] **Step 3: Commit**

```bash
git add -A src tests
git commit -m "fix: balancete semanal/mensal/anual só com resumo; balancete sozinho mostra o dia" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
