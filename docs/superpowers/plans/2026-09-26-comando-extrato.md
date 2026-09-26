# Comando `extrato` — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Novo comando `extrato`: o extrato completo da conta (todos os lançamentos de todos os períodos), em ordem **decrescente** (do mais recente para o mais antigo), **paginado**: o bot mostra uma página e diz qual comando digitar para ver a próxima.

**Architecture:** `src/parser.ts` reconhece `extrato` e `extrato N`; `src/service.ts` monta a página (totais gerais na primeira, lançamentos, rodapé de navegação); o repositório e o adaptador do WhatsApp não mudam (usa `repo.extrato`).

**Tech Stack:** o mesmo do projeto (Node + TypeScript, Vitest, MongoDB).

## Decisões do usuário (vinculantes)

- `extrato` traz o extrato completo da conta, do lançamento mais recente para o mais antigo.
- **Nada de várias mensagens seguidas:** o bot mostra **uma página** e **pede que o usuário digite um comando** para ver a próxima (`extrato 2`, `extrato 3`...).
- Ordem: `data` decrescente; empate por `enviadoEm` decrescente; empate por ordem de inserção decrescente (o inverso do que `repo.extrato` devolve).
- 20 lançamentos por página (`POR_PAGINA = 20`); totais gerais só na página 1.
- `extrato` é palavra reservada (`extrato 500` é pedido de página, nunca despesa); qualquer forma inválida responde a dica de uso.

## Global Constraints

- Valores em centavos inteiros; `formatBRL` de `src/money.ts` (com "R$").
- Fuso -03:00 (`rotuloDia`, `rotuloHora` de `src/period.ts`).
- Toda resposta começa com emoji (o parser nunca pode ler resposta do bot como comando); cada lançamento em duas linhas (`*dd/mm às HH:mm*` e `🟢/🔴 R$ valor · descrição`), como no balancete do dia.
- Mensagens recuperadas (`recuperada: true`) devolvem `null` para `extrato` e para o uso incorreto dele. Desfeitos nunca aparecem.
- Commit termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (segundo `-m`).

---

### Task 1: Comando `extrato` paginado

**Files:**
- Modify: `src/parser.ts`, `src/service.ts`, `tests/parser.test.ts`, `tests/service.test.ts` (o adaptador `src/whatsapp.ts` **não** muda)

**Interfaces:**
- `src/parser.ts`: `Comando` ganha `{ tipo: 'extrato'; pagina: number }`; `{ tipo: 'uso'; comando: 'balancete' | 'auditoria' | 'extrato' }`. `extrato` → `pagina: 1`; `extrato N` (inteiro positivo com 1 a 6 dígitos) → `pagina: N`; qualquer outra forma → `uso`. Sem diferenciar maiúsculas, espaços extras tolerados.
- `src/service.ts`: `export const POR_PAGINA = 20`. Texto de uso: `⚠️ Use *extrato* ou *extrato 2* (o número da página).` No `ajuda`, a linha `• extrato → lançamentos do mais recente ao mais antigo (extrato 2 = próxima página)`.

**Formato (golden).** Lançamentos: `+ salário 3000` (enviado `2026-09-05T12:00:00Z`), `mercado 345,90` (`2026-09-10T15:30:00Z`), `luz 166,50` (`2026-09-12T18:05:00Z`), `+ plantão 450 01/09` (enviado `2026-09-13T12:00:00Z`). Resposta de `extrato` (1 página só):

```
📒 *Extrato · página 1/1*

🟢 *Receitas* — R$ 3.450,00
🔴 *Despesas* — R$ 512,40
💰 *Saldo: R$ 2.937,60*

*12/09 às 15:05*
🔴 R$ 166,50 · luz
*10/09 às 12:30*
🔴 R$ 345,90 · mercado
*05/09 às 09:00*
🟢 R$ 3.000,00 · salário
*01/09 às 09:00*
🟢 R$ 450,00 · plantão
```

Regras:
- Busca: `repo.extrato({ de: new Date(0), ate: new Date('2100-01-01T00:00:00Z') })`, inverte (decrescente) e recorta a página.
- Páginas `k >= 2`: `📒 *Extrato · página k/N*`, linha em branco e os lançamentos (sem totais). Rodapé: se `k < N`, linha em branco e `➡️ Próxima página: digite *extrato {k+1}*`; na última página com `N > 1`, linha em branco e `✅ Fim do extrato`; com `N = 1`, sem rodapé.
- Página além do fim: `⚠️ O extrato tem só {N} página(s). Digite *extrato* para começar.` (singular/plural corretos).
- Sem lançamentos: `📒 *Extrato*\n\nSem lançamentos.`

Testes (TDD): o golden com `toBe`; empates de ordenação; vazio; desfeitos; totais só na página 1; 45 lançamentos → 3 páginas (20/20/5, rodapés `extrato 2`, `extrato 3` e `✅ Fim do extrato`; juntando as páginas saem os 45, uma vez cada, em ordem estritamente decrescente); página além do fim (N=3 e N=1); usos incorretos (`extrato 0`, `extrato abc`, `extrato -1`, `extrato 2 3`); `recuperada`; parser (formas válidas e inválidas, `extrato 500` não é despesa, respostas novas nunca viram comando).

- [ ] **Step 1:** Escreva os testes e veja falhar.
- [ ] **Step 2:** Implemente até passar. `npm run typecheck` e `npm test` verdes, saída limpa.
- [ ] **Step 3: Commit**

```bash
git add -A src tests
git commit -m "feat: comando extrato paginado (mais recente primeiro)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
