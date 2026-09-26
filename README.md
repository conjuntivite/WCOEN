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
| `- 130 role na avenida` ou `- role 130` | despesa (o `-` no início marca despesa; o valor pode vir antes ou depois) |
| `balancete` / `balancete tudo` / `balancete 08/2026` | resumo do mês / de tudo / de um mês |
| `balancete semana` / `balancete semana passada` | resumo da semana (segunda a domingo) |
| `balancete trimestre` | os 3 meses fechados antes do mês atual (em 20/06: março, abril e maio) |
| `balancete ano` / `balancete 2025` | ano do calendário atual / um ano específico |
| `balancete receitas` / `balancete despesas` | só receitas / só despesas (aceita período: `balancete semana despesas`) |
| `balancete mercado` | só a conta "mercado" (aceita período: `balancete ano mercado`) |
| `balancete ia carro` | soma, por IA, as contas do período relacionadas a "carro" (opcional: precisa do OpenRouter) |
| `+ plantão 450 ontem`, `mercado 45 15/09` | data opcional no fim: `hoje`, `ontem`, `anteontem`, `dd/mm`, `dd/mm/aaaa`. Sem data, vale o dia do envio da mensagem |
| `desfazer` | desfaz o último lançamento |
| `ajuda` | lista os comandos |

## IA opcional (agrupar contas)

Com `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` no `.env`, `balancete ia carro` pede à IA para escolher, entre as contas do período, as que se relacionam com "carro" (gasolina, óleo, mecânico...) e soma todas (aceita período: `balancete ano ia carro`). A IA **só é chamada quando você escreve `ia`**: `balancete carro` sempre soma apenas a conta "carro". Só os **nomes** das contas vão para o OpenRouter, nunca valores ou datas. A resposta traz `(agrupado por IA)` e lista o que entrou. `balancete ia <termo>` pode levar até ~45 s no pior caso (modelos de reserva); como as mensagens são processadas uma de cada vez, o bot só responde às outras depois dele. Sem a chave, o recurso fica desligado. Se o modelo principal falhar (rede, erro, resposta inválida), o bot tenta o próximo: `OPENROUTER_MODEL` aceita vários modelos separados por vírgula e, depois deles, entram modelos gratuitos de reserva (padrão do código ou `OPENROUTER_FALLBACK_MODELS`).

## Testes

`npm test` (precisa do Mongo de pé; `TEST_MONGO_URI` define o endereço, padrão `mongodb://localhost:27017`; os testes só mexem no banco `wcoen_test`).

## Se o WhatsApp desconectar o aparelho

Apague a pasta `auth` e rode `npm start` para escanear o QR de novo.
