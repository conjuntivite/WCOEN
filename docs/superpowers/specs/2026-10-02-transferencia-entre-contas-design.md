# Transferência entre contas correntes — design

Data: 2026-10-02

Depende de `docs/superpowers/specs/2026-10-02-contas-correntes-design.md` (PR #15).

## Objetivo

O cliente move dinheiro de uma conta corrente sua para outra pelo WhatsApp. A transferência altera o saldo das duas contas, mas **não é receita nem despesa**: não entra no balancete, na auditoria nem no dashboard.

## Vocabulário

"Transferência" é sempre entre duas contas correntes **do mesmo cliente**. `origem` é a conta de onde sai o dinheiro e `destino` a conta que recebe.

## Dados

`lancamentos` ganha `conta_destino_id TEXT` (opcional), via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Nada muda nos lançamentos antigos.

Uma transferência é **uma linha só** em `lancamentos`:

| Coluna | Valor |
|---|---|
| `tipo` | `'transferencia'` |
| `conta_corrente_id` | origem |
| `conta_destino_id` | destino |
| `conta` | `'transferência'` (descrição fixa) |
| `valor` | centavos, sempre positivo |
| `data`, `enviado_em`, `msg_id`, `remetente` | como nos demais lançamentos |

`desfeito_em` funciona como nos demais: desfazer a linha desfaz as duas pontas de uma vez.

No código, `Lancamento.tipo` passa a ser `Natureza | 'transferencia'` (novo tipo `TipoLancamento`) e `Lancamento` ganha `contaDestinoId?: string`. `Natureza` continua `'despesa' | 'receita'`: relatórios e `NovoLancamento` de receita/despesa não mudam.

## Comando do WhatsApp

- `/t 500 @nubank @itau`: sai do Nubank e vai para o Itaú. O primeiro `@` é a origem, o segundo o destino.
- `/t 500 @itau`: com um `@` só, sai da conta **favorita** e vai para o Itaú.
- Data opcional no fim, como nos lançamentos: `/t 500 @nubank @itau ontem`, `/t 500 @itau 15/09`. Os `@` podem estar em qualquer posição em relação à data e ao valor, mas a ordem entre os dois `@` define origem e destino.
- Alias: `/transferencia`. Texto da mensagem em minúsculas, como no parser atual.
- Valor no formato dos lançamentos (`parseValor`: positivo, `500`, `45,90`, `1.234,56`). Sem valor, sem `@`, mais de dois `@`, `@` malformado ou texto sobrando: `{ tipo: 'uso', comando: 'transferencia' }` e nada é gravado.
- Origem igual ao destino (inclusive favorita igual ao destino): nada é gravado, o bot responde "Origem e destino são a mesma conta".
- Origem ou destino inexistente ou desativado: nada é gravado, o bot responde "conta não encontrada" e lista as contas ativas, como nos lançamentos (`contaNaoEncontrada`, com "Nenhum lançamento foi registrado").
- Não bloqueia por saldo insuficiente: o saldo pode ficar negativo, como já pode hoje.
- Confirmação: `🔁 TRANSFERÊNCIA REGISTRADA`, depois `🏦 Nubank → Itaú` e `💰 R$ 500,00` (e `📅 dia` quando a data foi informada).
- `/ajuda` e `ui.USO` ganham `/t`.

## Saldo

`saldo atual = saldo inicial + receitas − despesas − transferências que saíram + transferências que entraram`, só de lançamentos não desfeitos, de todas as datas, calculado em SQL (`listar` em `contasCorrentes.ts`). A conta de origem perde o valor e a de destino ganha. Para o cliente, o saldo total das contas não muda.

## Relatórios

- Balancete, resumos mensal/semanal/anual, auditoria e dashboard **ignoram** transferências: só somam `receita` e `despesa`. `serieMensal`, `balancete` e os totais do `Service` (`somaTipo`) já filtram por tipo, e o teste do `Repo` garante isso.
- **Extrato** (`/e`) e **balancete do dia** (`/b`) mostram a linha `🔁 Nubank → Itaú` com o valor (sem sinal de receita ou despesa), **sem** entrar nos totais.
- `/e @nubank` e `/b @nubank` mostram as transferências em que a conta é origem **ou** destino. O filtro por conta nos relatórios de total não muda (transferências não somam).
- A auditoria não recebe transferências nos dados enviados à IA.

## Desfazer

`/desfazer` desfaz a última linha, qualquer que seja o tipo. Para transferência a resposta é `↩️ TRANSFERÊNCIA DESFEITA`, com `🏦 origem → destino` e o valor.

## Portal

Sem tela nova: lançamentos só nascem no WhatsApp. O saldo da página `/contas-correntes` e o `/contas` já refletem as transferências.

## Código

- `src/types.ts`: `TipoLancamento`; `Lancamento.tipo: TipoLancamento` e `contaDestinoId?`; `NovoLancamento` ganha a variante de transferência (`tipo: 'transferencia'`, `contaDestinoId`); `Repo.extrato` e o resto continuam com `contaCorrenteId?` como filtro (no extrato, casa origem ou destino).
- `src/repo.ts` e `tests/memoryRepo.ts`: grava `conta_destino_id`, devolve `contaDestinoId`, e o filtro do extrato casa origem ou destino.
- `src/contasCorrentes.ts`: o saldo em `listar` soma entradas e subtrai saídas de transferência.
- `src/parser.ts`: comando `transferencia` (`/t`, `/transferencia`) com `valor`, `data?`, `origem?` e `destino`.
- `src/service.ts`: resolve origem (favorita se faltar) e destino, valida, grava e responde; `/desfazer` e extrato com transferência.
- `src/presentation.ts`: confirmação, linha de extrato, desfazer, erros e ajuda.

## Testes

- Parser: um e dois `@`, ordem de origem e destino, data antes e depois, alias, uso incorreto (sem valor, sem `@`, três `@`, `@` malformado).
- Contrato do `Repo` (memória e Postgres): grava e devolve `contaDestinoId`; balancete, série mensal e totais ignoram transferência; extrato filtrado por origem ou destino; desfazer.
- `contasCorrentes.test.ts`: saldo com transferências em origem e destino, e transferência desfeita não conta.
- `Service`: origem favorita, origem explícita, mesma conta, conta inexistente ou desativada sem gravar, confirmação, `/desfazer`, extrato mostrando a linha sem somar nos totais.

## Fora desta versão

Tarifas, agendamento, bloqueio por saldo insuficiente, transferência entre clientes, descrição personalizada e cadastro de transferência pelo portal.
