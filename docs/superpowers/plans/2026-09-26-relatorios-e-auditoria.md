# Relatórios (mensal/semanal/anual) e Auditoria com IA — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os vários comandos de `balancete` por três relatórios (`mensal`, `semanal`, `anual`), cada um com extrato cronológico (data e hora), totais e resumo do histórico, e trocar o agrupamento de contas por IA por uma `auditoria` (ranking calculado em código + sugestões da IA).

**Architecture:** O código calcula todos os números (extrato, totais, rankings, comparações); a IA só recebe números prontos e escreve sugestões. Períodos em -03:00. O `Service` monta os textos; o `Repo` ganha `extrato` e perde os filtros e `contas`.

**Tech Stack:** o mesmo do projeto (Node + TypeScript, Vitest, MongoDB, `fetch` nativo para o OpenRouter). Sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-09-25-wcoen-design.md` (a seção de comandos é substituída por este plano; a spec será atualizada ao final) e as decisões abaixo, aprovadas pelo usuário.

## Decisões do usuário (vinculantes)

- Comandos: `balancete` (= `balancete mensal`), `balancete semanal`, `balancete anual`, `auditoria` (= `auditoria mensal`), `auditoria semanal`, `auditoria anual`. Todos os outros usos antigos de `balancete` (`trimestre`, `tudo`, `receitas`, `despesas`, `<conta>`, `ia <termo>`, `semana passada`, `MM/AAAA`, `AAAA`) deixam de existir.
- **Semana = domingo 00:00 a sábado 23:59** (7 dias, começa no domingo), em -03:00.
- **Extrato** cronológico com **data e hora**, receitas e despesas, e o saldo no fim. A hora é a do **envio da mensagem** (`enviadoEm`); a data é a do lançamento (`data`).
- `mensal`: extrato do mês atual + resumo dos **últimos 12 meses** (atual incluído). `semanal`: extrato da semana atual + resumo das **últimas 4 semanas** (atual incluída). `anual`: o ano atual **agrupado por mês** + resumo dos **últimos 5 anos** (atual incluído). **Períodos sem movimento não aparecem** nos resumos.
- A IA só é chamada pelo comando `auditoria`, **só com modelos pagos** (sem fallback gratuito), e **nunca faz conta**: os números vêm do código.

## Global Constraints

- Valores sempre em **centavos inteiros**; formatar com `formatBRL`/`formatValor` de `src/money.ts`.
- Fuso -03:00 fixo (como em `src/period.ts`); armazenamento em UTC.
- Toda resposta do bot começa com emoji (o parser nunca pode ler resposta do bot como comando) e usa os ícones: `🟢` receita, `🔴` despesa, `💰` saldo, `📊` balancete, `🔎` auditoria, `📅` extrato/data, `📈` resumo, `🏆` ranking, `📉` comparação, `💡` sugestões da IA, `⚠️` erro, `↩️` desfazer, `🤖` status do bot.
- Negrito do WhatsApp com `*texto*`; blocos separados por **uma linha em branco** (`\n\n`).
- Chave do OpenRouter nunca em log, mensagem de erro, commit ou resposta. A auditoria envia valores, datas e descrições ao OpenRouter: **somente** para modelos listados em `OPENROUTER_MODEL` (pagos), **nunca** para modelos gratuitos.
- Mensagens recuperadas (`recuperada: true`) só processam lançamento e desfazer; `balancete`, `auditoria`, aviso de uso e `ajuda` retornam `null`.
- Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (segundo `-m`).
- Mantenha o estilo do código existente (comentários curtos em português, sem abstrações a mais).

## Review Focus

1. **Mês/semana/ano vazios e sem nenhum lançamento** → nunca quebra nem mostra resumo com zeros: cada relatório mostra "Sem lançamentos neste mês/nesta semana/neste ano." (Tasks 2).
2. **Limites de período** (domingo 23:59 ainda é a mesma semana e domingo 00:00 já é a próxima; 31/12 23:59 e 01/01 00:00; virada de mês/ano nos resumos de 12 meses e 4 semanas) (Tasks 1 e 2).
3. **Ordem do extrato** por `data`, depois `enviadoEm`, depois inserção; lançamento retroativo aparece na sua data com a hora do envio (Tasks 1 e 2).
4. **Comandos antigos** (`balancete trimestre`, `balancete mercado`, `balancete ia carro`) respondem a dica de uso em vez de silêncio ou de virar lançamento (Task 2).
5. **Auditoria:** IA ausente, IA falhando, IA devolvendo lixo/vazio → nunca lança exceção, nunca manda dados a modelo gratuito, e o relatório calculado em código sai mesmo assim quando a IA falha (Task 3).

---

## Estado atual do código (leia antes de começar)

Código atual em `src/`: `money.ts`, `types.ts` (`Repo` com `add`, `desfazerUltimo`, `contas`, `balancete(intervalo, filtro?)`; `Filtro`, `DataLanc`, `Lancamento` com `data` e `enviadoEm`), `period.ts` (semana de segunda a domingo, trimestre, ano, `rotuloDia`, `rotuloMes`, `resolverData`), `parser.ts` (`balancete [período] [filtro]`, `ia <termo>`), `agrupar.ts` (agrupador de contas por IA com fallback gratuito), `service.ts`, `repo.ts` (Mongo), `config.ts`, `whatsapp.ts`, `index.ts`. Testes em `tests/` (`memoryRepo.ts` + `repo.contract.ts` compartilhados entre MemoryRepo e MongoRepo). Rode a suíte completa com `TEST_MONGO_URI=mongodb://localhost:27017 npm test` (Mongo do projeto, container `wcoen-mongo`, banco de testes `wcoen_test`).

---

### Task 1: Base aditiva — semana de domingo, hora e extrato no repositório

Só **acrescenta**; nada é removido nesta tarefa e a suíte toda continua verde.

**Files:**
- Modify: `src/period.ts`, `src/types.ts`, `src/repo.ts`, `tests/memoryRepo.ts`, `tests/repo.contract.ts`, `tests/period.test.ts`

**Interfaces:**
- Produces (`src/period.ts`):
  - `intervaloDaSemanaDomingo(agora: Date, deslocamento?: number): { de: Date; ate: Date }` — semana de **domingo 00:00 a domingo 00:00 seguinte** (locais, -03:00; `ate` exclusivo) que contém `agora`; `deslocamento` em semanas (`0` atual, `-1` anterior, `-3` três atrás; padrão `0`).
  - `rotuloHora(d: Date): string` — `HH:mm` no fuso local (-03:00), com zero à esquerda.
- Produces (`src/types.ts`, `Repo`): `extrato(intervalo: { de: Date; ate: Date }): Promise<Lancamento[]>` — lançamentos **não desfeitos** com `data` em `[de, ate)`, ordenados por `data` crescente, depois `enviadoEm` crescente, depois ordem de inserção.
- Consumes: `diaLocal`/`OFFSET_H` internos de `src/period.ts` (siga o estilo do arquivo).

- [ ] **Step 1: Testes que falham (TDD)** em `tests/period.test.ts`:
  - `intervaloDaSemanaDomingo(new Date('2026-09-15T12:00:00Z'))` (terça) → `de = 2026-09-13T03:00:00.000Z`, `ate = 2026-09-20T03:00:00.000Z`.
  - deslocamento `-1` → `2026-09-06T03:00Z` a `2026-09-13T03:00Z`; deslocamento `-3` → `2026-08-23T03:00Z` a `2026-08-30T03:00Z`.
  - sábado 23:59 local (`2026-09-20T02:59:00Z`) ainda é a semana que começou em `2026-09-13T03:00Z`; domingo 00:00 local (`2026-09-20T03:00:00Z`) já abre a semana que começa em `2026-09-20T03:00Z`.
  - virada de mês: `2026-09-02T12:00:00Z` (quarta) → `de = 2026-08-30T03:00:00.000Z`.
  - virada de ano: `2026-01-02T12:00:00Z` (sexta) → `de = 2025-12-28T03:00:00.000Z`.
  - `rotuloHora(new Date('2026-09-10T15:30:00Z'))` = `'12:30'`; `rotuloHora(new Date('2026-09-10T02:59:00Z'))` = `'23:59'`; `rotuloHora(new Date('2026-09-10T03:05:00Z'))` = `'00:05'`.
- [ ] **Step 2:** Rode e veja falhar. Implemente `intervaloDaSemanaDomingo` e `rotuloHora` em `src/period.ts` (reuse `diaLocal`; `Date.UTC` normaliza dias fora da faixa). Rode até passar.
- [ ] **Step 3: Contrato do `extrato`** em `tests/repo.contract.ts` (roda contra MemoryRepo e MongoRepo), com casos:
  - ordena por `data`, depois `enviadoEm`, depois inserção (insira fora de ordem e confira a ordem devolvida);
  - respeita `[de, ate)` (item em `ate` fica fora, item em `de` entra);
  - **exclui desfeitos** (use `desfazerUltimo`);
  - devolve `receita` e `despesa` misturadas, com `conta`, `valor`, `tipo`, `data`, `enviadoEm` preservados.
- [ ] **Step 4:** Adicione `extrato` à interface `Repo` (`src/types.ts`), ao `MemoryRepo` (`tests/memoryRepo.ts`) e ao `MongoRepo` (`src/repo.ts`: `find({ desfeitoEm: null, data: { $gte, $lt } }).sort({ data: 1, enviadoEm: 1, _id: 1 })`). Rode o contrato nas duas implementações até passar.
- [ ] **Step 5:** `npm run typecheck` e `TEST_MONGO_URI=mongodb://localhost:27017 npm test` — tudo verde, saída limpa.
- [ ] **Step 6: Commit**

```bash
git add src/period.ts src/types.ts src/repo.ts tests/memoryRepo.ts tests/repo.contract.ts tests/period.test.ts
git commit -m "feat: semana de domingo, hora local e extrato no repositório" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Os três relatórios (`balancete mensal|semanal|anual`) e limpeza dos comandos antigos

**Files:**
- Modify: `src/parser.ts`, `src/service.ts`, `src/period.ts`, `src/types.ts`, `src/repo.ts`, `src/index.ts`, `tests/parser.test.ts`, `tests/service.test.ts`, `tests/memoryRepo.ts`, `tests/repo.contract.ts`, `tests/period.test.ts`, `README.md`

**Interfaces:**
- Produces (`src/parser.ts`):
  ```ts
  export type Relatorio = 'mensal' | 'semanal' | 'anual'
  export type Comando =
    | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc }
    | { tipo: 'balancete'; relatorio: Relatorio }
    | { tipo: 'uso'; comando: 'balancete' | 'auditoria' }   // uso incorreto: o service responde a dica
    | { tipo: 'desfazer' }
    | { tipo: 'ajuda' }
  ```
  (`Periodo` e `FiltroPedido` deixam de existir; o comando `auditoria` só será reconhecido na Task 3, mas a palavra `auditoria` passa a ser **reservada** já agora: `auditoria 500` não vira despesa.)
- Consumes: `Repo.extrato`, `Repo.balancete(intervalo)`, `intervaloDaSemanaDomingo`, `rotuloHora`, `intervaloDoMes`, `intervaloDoAno`, `mesAtual`, `rotuloDia`, `rotuloMes` (Task 1 e existentes).
- `Service`: `new Service(repo, agora?)` — **remove** o parâmetro `agrupador` (a IA volta na Task 3). Exports mantidos: `Mensagem`, `Resposta`, `ERRO_SALVAR`, `ERRO_GENERICO`, `ERRO_DATA`, `IA_DESLIGADA` (a constante fica para a Task 3).

**Parser — regras:**
- `balancete` e `balancete mensal` → `{ tipo: 'balancete', relatorio: 'mensal' }`; `balancete semanal`, `balancete anual` idem. Sem diferenciar maiúsculas, tolerando espaços extras.
- Qualquer outra coisa depois de `balancete` (`balancete trimestre`, `balancete mercado`, `balancete ia carro`, `balancete 2025`, `balancete semana`) → `{ tipo: 'uso', comando: 'balancete' }`.
- `auditoria` e `auditoria <qualquer coisa>` → `null` por enquanto (palavra reservada; a Task 3 troca por comando).
- `desfazer`, `ajuda`, lançamentos e datas: **sem mudança** (incluindo `+ 70 plantão`, `- 130 role`, `ontem`, `15/09`).
- Testes: reescreva os de `balancete` (remova os de período/filtro/IA/`semana passada`/`trimestre`/`ano`/`tudo`, mantenha os de anti-eco) e cubra os novos, incluindo maiúsculas, espaços, `balancete mensal` vs `Balancete   Mensal `, e os usos incorretos acima.

**Service — formato exato (golden strings).** Dados de teste comuns (`agora = 2026-09-15T12:00:00Z`, terça):

`balancete` / `balancete mensal`, com lançamentos `+ salário 3000` (enviado `2026-09-05T12:00:00Z`), `mercado 345,90` (`2026-09-10T15:30:00Z`), `luz 166,50` (`2026-09-12T18:05:00Z`), `mercado 10` (`2026-08-31T12:00:00Z`):

```
📊 *Balancete mensal · 09/2026*

📅 *Extrato*
05/09 09:00 · 🟢 salário — R$ 3.000,00
10/09 12:30 · 🔴 mercado — R$ 345,90
12/09 15:05 · 🔴 luz — R$ 166,50

🟢 *Receitas* — R$ 3.000,00
🔴 *Despesas* — R$ 512,40
💰 *Saldo: R$ 2.487,60*

📈 *Últimos meses* (até 12, só com movimento)
09/2026 · 🟢 R$ 3.000,00 · 🔴 R$ 512,40 · 💰 R$ 2.487,60
08/2026 · 🟢 R$ 0,00 · 🔴 R$ 10,00 · 💰 -R$ 10,00
```

`balancete semanal`, com `mercado 10` (`2026-09-14T12:00:00Z`), `luz 20` (`2026-09-12T12:00:00Z`), `gas 30` (`2026-08-31T12:00:00Z`) — a semana atual é 13/09 a 19/09:

```
📊 *Balancete semanal · 13/09 a 19/09*

📅 *Extrato*
14/09 09:00 · 🔴 mercado — R$ 10,00

🟢 *Receitas* — R$ 0,00
🔴 *Despesas* — R$ 10,00
💰 *Saldo: -R$ 10,00*

📈 *Últimas 4 semanas* (só com movimento)
13/09 a 19/09 · 🟢 R$ 0,00 · 🔴 R$ 10,00 · 💰 -R$ 10,00
06/09 a 12/09 · 🟢 R$ 0,00 · 🔴 R$ 20,00 · 💰 -R$ 20,00
30/08 a 05/09 · 🟢 R$ 0,00 · 🔴 R$ 30,00 · 💰 -R$ 30,00
```
(a semana 23/08 a 29/08 não tem movimento e não aparece.)

`balancete anual`, com `+ salário 3000` (`2026-09-05T12:00:00Z`), `mercado 345,90` (`2026-09-10T15:30:00Z`), `luz 166,50` (`2026-09-12T18:05:00Z`), `mercado 10` (`2025-12-31T12:00:00Z`), `gas 5` (`2021-03-10T12:00:00Z`, fora dos 5 anos):

```
📊 *Balancete anual · 2026*

📅 *Por mês*
09/2026 · 🟢 R$ 3.000,00 · 🔴 R$ 512,40 · 💰 R$ 2.487,60

🟢 *Receitas* — R$ 3.000,00
🔴 *Despesas* — R$ 512,40
💰 *Saldo: R$ 2.487,60*

📈 *Últimos 5 anos* (só com movimento)
2026 · 🟢 R$ 3.000,00 · 🔴 R$ 512,40 · 💰 R$ 2.487,60
2025 · 🟢 R$ 0,00 · 🔴 R$ 10,00 · 💰 -R$ 10,00
```

Regras de montagem (blocos separados por `\n\n`):
- Cabeçalho `📊 *Balancete <relatório> · <título>*` (título: `MM/AAAA`; `dd/mm a dd/mm`; `AAAA`).
- Bloco do **extrato** (`📅 *Extrato*`; no anual `📅 *Por mês*` com uma linha por mês **com movimento** do ano atual, em ordem crescente): uma linha por lançamento, `dd/mm HH:mm · <🟢|🔴> <conta> — <R$ valor>`, ordem devolvida por `repo.extrato`.
- Bloco de **totais** (`🟢 *Receitas* — …`, `🔴 *Despesas* — …`, `💰 *Saldo: …*`, uma por linha no mesmo bloco) do período atual, somando os lançamentos do extrato (ou usando `repo.balancete`).
- Bloco de **resumo** (`📈 …`): uma linha por período **com movimento** do mais recente para o mais antigo, no formato `<rótulo> · 🟢 R$ … · 🔴 R$ … · 💰 R$ …`; janelas: 12 meses / 4 semanas / 5 anos, sempre **incluindo o atual**; use `repo.balancete(intervalo)` por período (as somas por conta, somadas, dão o total).
- **Sem lançamentos no período atual:** o bloco do extrato mostra `Sem lançamentos neste mês.` / `nesta semana.` / `neste ano.`, **sem** o bloco de totais; o resumo ainda aparece se algum período da janela tiver movimento. Sem nenhum movimento em lugar nenhum: só cabeçalho e o bloco do extrato com a frase.
- **Uso incorreto** (`{ tipo: 'uso', comando: 'balancete' }`): `⚠️ Use *balancete mensal*, *balancete semanal* ou *balancete anual*.`
- **Desfeitos** nunca aparecem (nem no extrato nem nos totais).
- Outros textos: **ajuda** — seção `📊 *Consultar*` passa a listar `• balancete mensal · semanal · anual → extrato + resumo` (a `auditoria` entra na Task 3); nada mais muda no `ajuda`.

**Limpeza (nesta mesma tarefa, sem deixar código morto):**
- `src/parser.ts`: remova `Periodo`, `FiltroPedido`, `BALANCETE`, `lerPeriodo`, `lerBalancete` e o que ficar sem uso.
- `src/types.ts`: remova `Filtro`; `Repo.balancete(intervalo)` (sem `filtro`); remova `Repo.contas`.
- `src/repo.ts` e `tests/memoryRepo.ts`: acompanhe (sem filtros, sem `contas`); `tests/repo.contract.ts`: remova os casos de filtro e de `contas`.
- `src/period.ts`: remova `intervaloDoTrimestre` e o antigo `intervaloDaSemana` (segunda a domingo) com seus testes; mantenha `intervaloDoMes`, `intervaloDoAno`, `intervaloDaSemanaDomingo`, `mesAtual`, `resolverData`, `rotuloDia`, `rotuloMes`, `rotuloHora`.
- `src/service.ts`: remova o parâmetro `agrupador`, o ramo `tema`, os filtros e os textos antigos do balancete; `src/index.ts`: `new Service(mongo.repo)` (sem agrupador). `src/agrupar.ts`, `src/config.ts` **não** são tocados aqui (a Task 3 os substitui).
- `README.md`: tabela de comandos com `balancete mensal|semanal|anual` (e as regras de semana de domingo e resumos).

- [ ] **Step 1:** Escreva os testes (parser e service com as strings acima, exatamente) e veja falhar.
- [ ] **Step 2:** Implemente parser, service, limpeza; rode até passar. Cubra também: mês sem lançamentos mas com histórico; nenhum lançamento; desfeito some; lançamento retroativo (`+ plantão 450 01/09`) aparece em `01/09` com a hora do envio; virada de ano no resumo de meses (ex.: `agora = 2026-01-10`); uso incorreto (`balancete mercado`, `balancete ia carro`, `balancete trimestre`); `recuperada: true` devolve `null` para `balancete`, uso incorreto e `ajuda`.
- [ ] **Step 3:** `npm run typecheck` e `TEST_MONGO_URI=mongodb://localhost:27017 npm test` — tudo verde, saída limpa.
- [ ] **Step 4: Commit**

```bash
git add -A src tests README.md
git commit -m "feat: balancete mensal, semanal e anual com extrato e resumos" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Auditoria com IA (`auditoria mensal|semanal|anual`)

**Files:**
- Create: `src/auditar.ts`, `tests/auditar.test.ts`
- Delete: `src/agrupar.ts`, `tests/agrupar.test.ts`
- Modify: `src/parser.ts`, `src/service.ts`, `src/config.ts`, `src/index.ts`, `tests/parser.test.ts`, `tests/service.test.ts`, `tests/config.test.ts`, `README.md`, `.env.example` (se existir; senão só o README)

**Interfaces:**
- Parser: `{ tipo: 'auditoria'; relatorio: Relatorio }` para `auditoria` (= mensal), `auditoria mensal|semanal|anual` (maiúsculas e espaços tolerados); qualquer outro texto depois de `auditoria` → `{ tipo: 'uso', comando: 'auditoria' }`. Texto de uso: `⚠️ Use *auditoria mensal*, *auditoria semanal* ou *auditoria anual*.`
- Produces (`src/auditar.ts`):
  ```ts
  export type DadosAuditoria = {
    periodo: string                       // rótulo, ex.: "09/2026"
    receitas: string; despesas: string; saldo: string   // já formatados, ex.: "R$ 3.000,00"
    rankingDespesas: { conta: string; valor: string; percentual: number }[]   // até 5, do maior para o menor
    receitasPorConta: { conta: string; valor: string }[]
    comparacao?: { periodo: string; receitas: string; despesas: string; saldo: string }   // período anterior, se houver movimento
    lancamentos: { data: string; tipo: 'receita' | 'despesa'; conta: string; valor: string }[]   // no máximo os 200 mais recentes
  }
  export interface Auditor { sugerir(dados: DadosAuditoria): Promise<string[]> }   // até 5 sugestões, sem o "• " inicial; pode lançar
  export function limparSugestoes(texto: string): string[] | null
  export type OpcoesOpenRouter = { apiKey: string; models: string[]; fetchFn?: typeof fetch }
  export function criarAuditorOpenRouter(op: OpcoesOpenRouter): Auditor
  ```
- `limparSugestoes(texto)`: divide em linhas, tira espaços, ignora vazias, remove marcadores no início (`-`, `*`, `•`, `1.`, `1)`), corta cada sugestão em 200 caracteres (com `…`), mantém no máximo 5; devolve `null` se não sobrar nenhuma.
- `criarAuditorOpenRouter`: chama `https://openrouter.ai/api/v1/chat/completions` com `temperature: 0.3`, as mensagens `system` (prompt abaixo) e `user` (`JSON.stringify(dados)`), timeout **30 s por tentativa** e **prazo total de 45 s**; tenta os `models` em ordem (uma vez cada); falha (rede, HTTP não-OK, timeout, conteúdo ausente, `limparSugestoes` = `null`) passa ao próximo; se todos falharem, lança o último erro; a cada falha `console.warn` com o modelo e o motivo, **nunca** com a chave; sem modelos, lança `nenhum modelo configurado para a IA` sem chamar a rede. Prompt (sistema): `Você é um consultor de finanças pessoais. Recebe um JSON com o resumo e os lançamentos de um período. Use SOMENTE os números fornecidos, nunca invente ou recalcule valores. Responda em português com 3 a 5 sugestões curtas, uma por linha, cada uma começando com "• ", sem títulos e sem formatação. Aponte os maiores gastos, variações em relação ao período anterior e formas práticas de economizar. Se houver poucos dados, diga isso em uma linha.`
- `Config.openrouter?: { apiKey: string; models: string[] }` com `models` = **somente** os de `OPENROUTER_MODEL` (separados por vírgula; obrigatório com a chave). **Remova** a reserva gratuita (`GRATUITOS_PADRAO`, `OPENROUTER_FALLBACK_MODELS`) e os testes dela; ajuste `.env.example`/README.
- `Service`: `new Service(repo, agora?, auditor?)`.

**Formato da auditoria (golden).** Dados: os do `balancete mensal` da Task 2 (`agora = 2026-09-15T12:00:00Z`), auditor falso que devolve `['Reduza os gastos com mercado', 'Monte uma reserva']`:

```
🔎 *Auditoria mensal · 09/2026*

🟢 *Receitas* — R$ 3.000,00
🔴 *Despesas* — R$ 512,40
💰 *Saldo: R$ 2.487,60*

🏆 *Maiores gastos*
1. mercado — R$ 345,90 (68%)
2. luz — R$ 166,50 (32%)

📉 *Comparado a 08/2026*
🟢 Receitas: R$ 0,00 → R$ 3.000,00
🔴 Despesas: R$ 10,00 → R$ 512,40 (+5024%)
💰 Saldo: -R$ 10,00 → R$ 2.487,60

💡 *Sugestões da IA*
• Reduza os gastos com mercado
• Monte uma reserva
```
- Percentual = `Math.round(valor * 100 / totalDespesas)`; variação de despesas `(+N%)`/`(-N%)` = `Math.round((atual - anterior) * 100 / anterior)` **só quando o anterior é maior que zero** (sem parênteses caso contrário); a linha de receitas e a de saldo não têm percentual.
- Período anterior: mensal → mês anterior; semanal → semana anterior; anual → ano anterior. Sem movimento no anterior: **omita** o bloco `📉`.
- Rótulos e títulos: mensal `MM/AAAA`; semanal `dd/mm a dd/mm`; anual `AAAA`.
- **Sem lançamentos no período atual:** `🔎 *Auditoria mensal · 09/2026*\n\nSem lançamentos no período.` (nenhuma chamada de IA).
- **Sem auditor configurado:** `🔎 *Auditoria mensal · 09/2026*\n\n<IA_DESLIGADA>` (constante existente: `A IA não está configurada (defina OPENROUTER_API_KEY e OPENROUTER_MODEL no .env).`).
- **Auditor lança erro ou devolve lista vazia:** o relatório calculado (tudo acima, menos as sugestões) sai normalmente, terminando com o bloco `💡 *Sugestões da IA*\nIndisponível agora, tente de novo.`; o erro vai para `console.error` (sem a chave); **nunca** lança exceção.
- O ranking, os totais e as comparações são calculados em código (`repo.balancete`, `repo.extrato`); a IA **só** recebe `DadosAuditoria` e devolve texto.
- `recuperada: true` → `auditoria` retorna `null`.
- `ajuda`: adicione na seção `📊 *Consultar*` a linha `• auditoria mensal · semanal · anual → ranking e dicas da IA`.
- `src/index.ts`: cria o auditor só se `config.openrouter` existir e passa como terceiro argumento de `Service`.

- [ ] **Step 1:** Testes que falham para `limparSugestoes`, `criarAuditorOpenRouter` (fetch falso: URL, chave só no header, corpo com os dados e sem chave, fallback entre modelos pagos, todos falham, sem modelos, resposta fora do combinado, aviso sem vazar a chave), parser (`auditoria`, `auditoria semanal`, uso incorreto), config (só modelos de `OPENROUTER_MODEL`; sem reserva gratuita) e service (golden acima, comparação omitida, percentual sem base zero, sem lançamentos, sem auditor, auditor falhando, semanal e anual, `recuperada`). **Nenhum teste pode tocar a rede.**
- [ ] **Step 2:** Implemente até passar; apague `src/agrupar.ts` e `tests/agrupar.test.ts` (o cliente novo reaproveita a ideia do laço de modelos com fallback).
- [ ] **Step 3:** `npm run typecheck` e `TEST_MONGO_URI=mongodb://localhost:27017 npm test` — tudo verde, saída limpa.
- [ ] **Step 4: Commit**

```bash
git add -A src tests README.md .env.example
git commit -m "feat: auditoria com IA (ranking em código e sugestões do modelo pago)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
