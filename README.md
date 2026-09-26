# WCOEN

Bot de WhatsApp (Baileys) que registra despesas e receitas num grupo seu e monta o balancete. Dados no seu MongoDB (Docker).

## Rodar

Requer Node >= 20.6 (o `npm start` usa `--env-file`).

1. Suba o Mongo do Docker.
2. `copy .env.example .env` e ajuste `MONGO_URI`.
3. `npm install`
4. Crie um grupo no WhatsApp só seu.
5. `npm start` com `GROUP_ID` vazio: escaneie o QR (WhatsApp > Aparelhos conectados). O bot lista os grupos e sai. Logo depois de escanear o QR, uma linha como `Conexão caiu (código 515); nova tentativa em 1s` é NORMAL e esperada, não é erro.
6. Cole o ID do grupo (`...@g.us`) em `GROUP_ID` no `.env`.
7. `npm start` de novo. O bot avisa `🤖 Bot online` no grupo.

## Comandos (no grupo)

| Digite | Efeito |
|---|---|
| `mercado 45,90` | despesa |
| `+ 70 plantão` ou `+ plantão 70` | receita (o `+` no início marca receita; o valor pode vir antes ou depois) |
| `salário 3000`, `plantão 450`, `venda beck 120` | receita **sem precisar do `+`**, quando a descrição começa com uma palavra de receita: salário, décimo terceiro, plantão, freela/freelance, comissão, bônus, venda(s), reembolso, rendimento(s), pró-labore. O sinal `-` sempre vence (`- salário 100` é despesa). Palavras ambíguas (`pix`, `pagamento`, `aluguel`) exigem o `+` |
| `- 130 role na avenida` ou `- role 130` | despesa (o `-` no início marca despesa; o valor pode vir antes ou depois) |
| `balancete` / `balancete mensal` | extrato do mês atual (data, hora, receitas e despesas), totais e resumo dos últimos 12 meses |
| `balancete semanal` | extrato da semana atual (domingo a sábado) e resumo das últimas 4 semanas |
| `balancete anual` | o ano atual agrupado por mês e resumo dos últimos 5 anos |
| `auditoria` / `auditoria mensal` / `semanal` / `anual` | totais, ranking de gastos, comparação com o período anterior e dicas da IA (ver abaixo) |
| `+ plantão 450 ontem`, `mercado 45 15/09` | data opcional no fim: `hoje`, `ontem`, `anteontem`, `dd/mm`, `dd/mm/aaaa`. Sem data, vale o dia do envio da mensagem |
| `desfazer` | desfaz o último lançamento |
| `ajuda` | lista os comandos |

Nos resumos, períodos sem movimento não aparecem. A hora do extrato é a do envio da mensagem; a data é a do lançamento. Qualquer outro uso de `balancete` (`trimestre`, `tudo`, uma conta...) responde com a dica dos três relatórios. O mesmo vale para `auditoria <outra coisa>`.

A auditoria pode levar até ~45 s (chamada à IA); o bot processa uma mensagem por vez, então o que for digitado nesse intervalo espera (um desligamento nessa janela pode perdê-lo).

## IA opcional

`auditoria` (= `auditoria mensal`), `auditoria semanal` e `auditoria anual` mostram os totais, o ranking dos 5 maiores gastos e a comparação com o período anterior (tudo calculado pelo bot) e, no fim, até 5 dicas escritas por uma IA (OpenRouter). A IA só escreve as dicas: não faz conta nem grava nada.

Para ligar, defina no `.env` `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` (um ou mais modelos **pagos**, separados por vírgula, tentados em ordem). Sem a chave, `auditoria` responde que a IA não está configurada.

**Privacidade:** a auditoria envia valores, datas e descrições dos lançamentos do período ao OpenRouter, somente para os modelos de `OPENROUTER_MODEL`. Não há modelo gratuito de reserva. Se todos falharem, o relatório sai com "Indisponível agora, tente de novo." nas dicas.

## Testes

`npm test` (precisa do Mongo de pé; `TEST_MONGO_URI` define o endereço, padrão `mongodb://localhost:27017`; os testes só mexem no banco `wcoen_test`).

## Se o WhatsApp desconectar o aparelho

Apague a pasta `auth` e rode `npm start` para escanear o QR de novo.
