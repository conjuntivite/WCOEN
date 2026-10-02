# Contas correntes — design

Data: 2026-10-02

## Objetivo

O cliente cadastra uma ou mais contas correntes no portal e marca uma como **favorita**. Todo lançamento do WhatsApp (`/d`, `/r`) vai para a favorita, salvo se o usuário indicar outra no próprio comando. Os comandos continuam curtos.

## Vocabulário

No código, "conta" já tem dois sentidos: o login do cliente (`src/contas.ts`, coluna `lancamentos.conta_id`) e a descrição do lançamento (`lancamentos.conta`, `LinhaConta`). A nova entidade se chama **`ContaCorrente`** (tabela `contas_correntes`, coluna `lancamentos.conta_corrente_id`). Na interface e nas mensagens ao usuário, "conta" ou "conta corrente".

## Dados

Tabela `contas_correntes`:

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | TEXT PK | UUID |
| `conta_id` | TEXT NOT NULL | cliente dono |
| `apelido` | TEXT NOT NULL | minúsculo, `[a-z0-9_-]{1,20}`, único por cliente |
| `nome` | TEXT NOT NULL | até 40 caracteres |
| `saldo_inicial` | BIGINT NOT NULL DEFAULT 0 | centavos, pode ser negativo |
| `favorita` | BOOLEAN NOT NULL DEFAULT false | |
| `ativa` | BOOLEAN NOT NULL DEFAULT true | |
| `criada_em` | TIMESTAMPTZ NOT NULL | |

Índices: `UNIQUE (conta_id, apelido)` e `UNIQUE (conta_id) WHERE favorita` (no máximo uma favorita por cliente).

`lancamentos` ganha `conta_corrente_id TEXT` (via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, como o resto do projeto).

Regras:
- Não há exclusão, só desativar.
- A favorita não pode ser desativada nem deixar de ser favorita sem outra assumir; eleger uma nova favorita troca a anterior na mesma operação.
- A favorita deve estar ativa.
- Só conta ativa recebe lançamentos novos; o histórico das desativadas continua nos relatórios e nos filtros.

### Migração

Ao subir, para cada `conta_id` com lançamentos e sem conta corrente: cria "Principal" (`@principal`), favorita, saldo inicial 0, e aponta os lançamentos antigos para ela. Cliente novo ganha a "Principal" no primeiro uso (`garantirPadrao(contaId)`), que é idempotente. Lançamento com `conta_corrente_id` nulo não deve existir depois disso.

## Comandos do WhatsApp

- **Lançar:** `/d mercado 45,90 @nubank`. O token `@apelido` pode vir em qualquer posição, antes ou depois da data (`/d mercado 45,90 ontem @nubank`). Formato do token: `@` + `[a-z0-9_-]{1,20}`. O parser remove o token antes de ler descrição, valor e data. Mais de um `@` no mesmo comando devolve a dica de uso.
- **`@` desconhecido ou desativado:** nada é gravado; o bot responde "conta @x não existe" e lista as contas ativas. Sem `@`, vale a favorita.
- **Filtros:** `/b @nubank`, `/b mensal @nubank`, `/e @nubank`, `/e 2 @nubank`. O `@` também vale em qualquer posição. Sem `@`, somam todas as contas (ativas e desativadas). `/auditoria` ignora filtro e continua consolidada; `@` nela devolve a dica de uso.
- **`/contas` (atalho `/c`):** lista apelido, nome e saldo atual de cada conta ativa, marcando a favorita.
- **Confirmação do lançamento:** quando o cliente tem 2 ou mais contas ativas, a resposta termina com o nome da conta (`✅ mercado R$ 45,90 · Nubank`); com uma só, fica como hoje.
- `/ajuda` e `ui.USO` passam a mencionar `@conta` e `/contas`.

## Saldo

`saldo atual = saldo_inicial + receitas − despesas` dos lançamentos da conta, sem os desfeitos, de todas as datas. Calculado em SQL pelo repositório; nenhuma IA envolvida.

## Portal

- Página `/contas-correntes` (a rota `/contas` já é do admin), só da própria conta de login: lista com saldo atual, formulário de criar (apelido, nome, saldo inicial), editar nome e saldo inicial, favoritar, desativar e reativar. O apelido não muda depois de criado, porque o usuário o digita nos comandos.
- Dashboard: seletor de conta (padrão: todas), com o mesmo filtro do bot, aplicado a saldo, receitas, despesas, tendência e categorias.
- Erros de validação voltam na própria página, no padrão das demais telas.

## Código

- `src/contasCorrentes.ts` (novo, no padrão de `contas.ts`): `criarContasCorrentes(pool)` com `garantirPadrao`, `listar`, `criar`, `editar`, `favoritar`, `definirAtiva`, `porApelido` e `saldos`.
- `src/types.ts`:
  - `NovoLancamento` ganha `contaCorrenteId: string`.
  - `balancete`, `extrato` e `serieMensal` ganham um parâmetro opcional `contaCorrenteId?: string`.
- `src/repo.ts` e `tests/memoryRepo.ts` aplicam o filtro e gravam o campo; `saldos` fica em `contasCorrentes.ts`, lendo `lancamentos`.
- `src/parser.ts`: extrai `@apelido`; `Comando` ganha `contaCorrente?: string` em `lancamento`, `balancete` e `extrato`, e o tipo `contas`.
- `src/service.ts`: recebe a porta de contas correntes do cliente, resolve apelido → id, aplica a favorita como padrão e monta as respostas.
- `src/presentation.ts`: textos novos (confirmação com conta, `/contas`, conta inexistente, ajuda).
- `src/web.ts` e `src/paginas.ts`: página e ações de `/contas-correntes` e seletor do dashboard.
- `src/index.ts`: injeta `contasCorrentes` onde cria o `Service` e o `Leitura`.

## Testes

- `tests/parser.test.ts`: `@` em qualquer posição, junto de data, duplicado, formato inválido, `/c`, filtros em `/b` e `/e`.
- `tests/repo.contract.ts` (memória e Postgres): filtro por conta corrente em balancete, extrato e série mensal; gravação do campo.
- `tests/contasCorrentes.test.ts` (novo): criar, apelido duplicado, favorita única e troca, desativar a favorita recusado, saldo, migração e `garantirPadrao` idempotente.
- `tests/service.test.ts`: favorita como padrão, `@outra`, `@` inexistente sem gravar, confirmação com e sem nome da conta, `/contas`.
- `tests/web.test.ts` e `tests/paginas.test.ts`: página de contas correntes e seletor do dashboard, sempre isolados por cliente.

## Fora desta versão

Transferência entre contas, filtro na auditoria, exclusão de conta, mudança de apelido.
