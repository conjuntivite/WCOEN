# Comando `extrato` — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Novo comando `extrato`: o extrato completo da conta (todos os lançamentos de todos os períodos), em ordem **decrescente** (do mais recente para o mais antigo), dividido em várias mensagens quando for grande.

**Architecture:** `src/parser.ts` reconhece o comando; `src/service.ts` monta o texto (totais gerais + lançamentos) e o divide em partes; a interface `Resposta` ganha `continuacao?: string[]` (mensagens extras enviadas em sequência); `src/whatsapp.ts` envia as partes extras. O repositório não muda (usa `repo.extrato`).

**Tech Stack:** o mesmo do projeto (Node + TypeScript, Vitest, MongoDB).

## Decisões do usuário e do controlador (vinculantes)

- `extrato` traz **todo** o extrato da conta, do lançamento mais recente para o mais antigo.
- Ordem: `data` decrescente; empate por `enviadoEm` decrescente; empate por ordem de inserção decrescente (é exatamente o inverso do que `repo.extrato` devolve).
- Como o extrato pode ser enorme, ele é dividido em **mensagens de até 3500 caracteres**, cortando **só entre lançamentos** (nunca no meio de um), numeradas; a primeira traz o cabeçalho e os totais gerais.
- `extrato <qualquer coisa>` responde a dica de uso; `extrato` vira palavra reservada (`extrato 500` não vira despesa).

## Global Constraints

- Valores em centavos inteiros; `formatBRL` de `src/money.ts` (com "R$").
- Fuso -03:00 (helpers de `src/period.ts`: `rotuloDia`, `rotuloHora`).
- Toda resposta começa com emoji (o parser nunca pode ler resposta do bot como comando) e usa `*negrito*`; cada lançamento em duas linhas (`*dd/mm às HH:mm*` e `🟢/🔴 R$ valor · descrição`), como no balancete do dia.
- Mensagens recuperadas (`recuperada: true`) devolvem `null` para `extrato` e para o uso incorreto dele.
- Desfeitos nunca aparecem.
- Commit termina com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (segundo `-m`).

---

### Task 1: Comando `extrato`

**Files:**
- Modify: `src/parser.ts`, `src/service.ts`, `src/whatsapp.ts`, `tests/parser.test.ts`, `tests/service.test.ts`

**Interfaces:**
- `src/parser.ts`: `Comando` ganha `{ tipo: 'extrato' }`; `{ tipo: 'uso'; comando: 'balancete' | 'auditoria' | 'extrato' }`. `extrato` (sem diferenciar maiúsculas, espaços extras tolerados) → `{ tipo: 'extrato' }`; `extrato <qualquer coisa>` → `{ tipo: 'uso', comando: 'extrato' }`; `extrato` entra em `RESERVADAS`.
- `src/service.ts`: `Resposta = { texto: string; lancou: boolean; continuacao?: string[] }` (`continuacao` = mensagens extras, na ordem, enviadas depois de `texto`); `export const MAX_MENSAGEM = 3500`. Texto de uso: `⚠️ Use *extrato* (sem mais nada).` Na seção `📊 *Consultar*` do `ajuda`, acrescente a linha `• extrato → todos os lançamentos, do mais recente ao mais antigo`.
- `src/whatsapp.ts`: depois de enviar `r.texto`, envia cada item de `r.continuacao` (se houver), em ordem, um por vez (mesmo `enviar` com o atraso normal). Nada mais muda no adaptador. Não há teste automatizado do adaptador (por projeto); valide por leitura e typecheck.

**Formato (golden).** Lançamentos: `+ salário 3000` (enviado `2026-09-05T12:00:00Z`), `mercado 345,90` (`2026-09-10T15:30:00Z`), `luz 166,50` (`2026-09-12T18:05:00Z`) e `+ plantão 450 01/09` (enviado `2026-09-13T12:00:00Z`, data informada 01/09). Resposta de `extrato` (uma só mensagem, `continuacao` ausente):

```
📒 *Extrato completo*

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
(a data é a `data` do lançamento; a hora é a do **envio**: o plantão retroativo mostra `01/09` com `09:00`, que é a hora em que foi enviado.)

Regras:
- **Busca:** `repo.extrato({ de: new Date(0), ate: <data muito no futuro, ex.: new Date('2100-01-01T00:00:00Z')> })` e depois **inverte** a lista (decrescente). Os totais gerais somam **todos** os lançamentos devolvidos.
- **Sem lançamentos:** `📒 *Extrato completo*\n\nSem lançamentos.`
- **Divisão em partes:** o texto completo = cabeçalho + totais + lançamentos. Se cabe em `MAX_MENSAGEM` caracteres, sai numa só mensagem (como no golden). Se não cabe, divide em N partes, cortando **somente entre lançamentos**, cada parte com **no máximo `MAX_MENSAGEM` caracteres** (contando o título da parte). A primeira parte é o cabeçalho (`📒 *Extrato completo · parte 1/N*`), os totais e os primeiros lançamentos; as demais começam com `📒 *Extrato · parte k/N*`, uma linha em branco e os lançamentos. `texto` é a parte 1; `continuacao` são as partes 2..N. Nenhum lançamento pode ficar de fora, repetido ou fora de ordem entre as partes. Um lançamento sozinho nunca passa de `MAX_MENSAGEM` (descrição ≤ 40 caracteres), então a divisão sempre termina.
- **`recuperada: true`:** `extrato` e o uso incorreto dele retornam `null`.
- **Não quebre:** lançamentos, `balancete`, `auditoria`, `desfazer`, `ajuda`.

Testes (TDD):
- Parser: `extrato`, `Extrato`, `  EXTRATO  ` → `{ tipo: 'extrato' }`; `extrato mensal`, `extrato 500`, `extrato hoje` → `uso`; `extrato 500` **não** vira despesa; as linhas novas nunca viram comando (`📒 *Extrato completo*`, `*12/09 às 15:05*`, `🔴 R$ 166,50 · luz`, `📒 *Extrato · parte 2/3*`).
- Service: o golden acima com `toBe`; ordem decrescente com **empate** de `data` (dois lançamentos no mesmo dia: o de `enviadoEm` mais recente vem primeiro; e, se `enviadoEm` também empata, o inserido por último vem primeiro); vazio; desfeito não aparece; totais gerais; divisão: com ~200 lançamentos (mensagens curtas geradas em loop, datas diferentes) confira que existe `continuacao`, que **cada parte tem ≤ `MAX_MENSAGEM` caracteres**, que a numeração `parte k/N` é consistente, que juntando os lançamentos das partes na ordem saem **todos, sem repetir, em ordem decrescente**, e que nenhum lançamento foi cortado no meio (cada parte só tem linhas `*dd/mm às HH:mm*` seguidas da linha de valor); uso incorreto; `recuperada`.

- [ ] **Step 1:** Escreva os testes (parser e service) e veja falhar.
- [ ] **Step 2:** Implemente parser, service e a pequena mudança do adaptador; rode até passar. `npm run typecheck` e `npm test` verdes, saída limpa.
- [ ] **Step 3: Commit**

```bash
git add -A src tests
git commit -m "feat: comando extrato (todos os lançamentos, do mais recente ao mais antigo)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
