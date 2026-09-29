<p align="center">
  <img src="src/assets/logo.svg" alt="WCOEN" width="420">
</p>

# WCOEN

Bot de WhatsApp (Baileys) que registra despesas e receitas num grupo seu e monta o balancete. Dados no seu Postgres (Docker ou Supabase).

## Rodar

Requer Node >= 20.6 (o `npm start` usa `--env-file`).

1. Suba o Postgres do Docker: `docker compose up -d postgres`.
2. `copy .env.example .env` e ajuste `DATABASE_URL` (o padrão já aponta pro Postgres local do compose).
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
| `balancete` | os movimentos **de hoje** (dia, hora, valor e descrição de cada um) e o total do dia |
| `balancete mensal` | resumo (receitas, despesas e saldo) do mês atual e dos meses anteriores, até 12 |
| `balancete semanal` | resumo da semana atual (domingo a sábado) e das 3 anteriores |
| `balancete anual` | resumo do ano atual e dos 4 anteriores |
| `extrato` / `extrato 2` | todos os lançamentos, do mais recente ao mais antigo, **20 por página**; no fim da página o bot diz qual comando digitar para ver a próxima (`extrato 2`, `extrato 3`...) |
| `auditoria` (+ `semanal` ou `anual`) | ranking dos maiores gastos, comparação com o período anterior e sugestões da IA |
| `+ plantão 450 ontem`, `mercado 45 15/09` | data opcional no fim: `hoje`, `ontem`, `anteontem`, `dd/mm`, `dd/mm/aaaa`. Sem data, vale o dia do envio da mensagem |
| `desfazer` | desfaz o último lançamento |
| `ajuda` | lista os comandos |

Nos resumos (mensal, semanal e anual), períodos sem movimento não aparecem. No balancete do dia, a hora é a do envio da mensagem e a data é a do lançamento. Qualquer outro uso de `balancete` (`trimestre`, `tudo`, uma conta...) responde com a dica dos comandos; o mesmo vale para `auditoria <outra coisa>`.

A auditoria pode levar até ~45 s (chamada à IA); o bot processa uma mensagem por vez, então o que for digitado nesse intervalo espera (um desligamento nessa janela pode perdê-lo).

## IA opcional

`auditoria` (= `auditoria mensal`), `auditoria semanal` e `auditoria anual` mostram os totais, o ranking dos 5 maiores gastos e a comparação com o período anterior (tudo calculado pelo bot) e, no fim, até 5 dicas escritas por uma IA (OpenRouter). A IA só escreve as dicas: não faz conta nem grava nada.

Para ligar, defina no `.env` `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` (um ou mais modelos **pagos**, separados por vírgula, tentados em ordem). Sem a chave, `auditoria` responde que a IA não está configurada.

**Privacidade:** a auditoria envia valores, datas e descrições dos lançamentos do período ao OpenRouter, somente para os modelos de `OPENROUTER_MODEL`. Não há modelo gratuito de reserva. Se todos falharem, o relatório sai com "Indisponível agora, tente de novo." nas dicas.

## Testes

`npm test` (precisa do Postgres de pé — `docker compose up -d postgres`; `TEST_DATABASE_URL` define o
endereço, padrão `postgres://postgres:wcoen@localhost:5432/wcoen_test`; os testes usam um banco **separado**
do de desenvolvimento (`wcoen_test`), criado automaticamente na primeira execução, e recriam as tabelas a
cada execução).

## Se o WhatsApp desconectar o aparelho

Apague a pasta `auth` e rode `npm start` para escanear o QR de novo.

## Portal (SaaS)

O bot roda como serviço: cada cliente se cadastra no portal, conecta o próprio WhatsApp (QR ou código de pareamento) e escolhe o grupo onde o bot responde. Detalhes em `docs/superpowers/specs/2026-09-26-portal-saas-design.md`.

### Subir em um servidor

1. Copie `.env.example` para `.env` e preencha `CONVITE`, `CHAVE_CRIPTO` e `DOMINIO` (o DNS do domínio deve apontar para o servidor; portas 80 e 443 abertas).
2. `docker compose up -d`. O Caddy emite o HTTPS sozinho; o Postgres não é exposto fora da rede do compose.
3. Acesse `https://SEU_DOMINIO`, cadastre-se com o convite e conecte o WhatsApp.

### Administração

Definir `ADMIN_EMAILS` (e-mails já cadastrados, separados por vírgula) libera `/admin` para essas contas — um link "Administração" aparece no painel delas. Lá dá para gerar convites de uso único (com uma nota opcional para lembrar quem é) e revogar os que ainda não foram usados. O `CONVITE` do `.env` continua funcionando como plano B, multiuso, para não depender só do banco de convites.

### Operação

- **Redefinir senha de um cliente:** `npm run senha -- email@cliente.com nova-senha-123`.
- **Backup do banco:** `docker compose exec -T postgres pg_dump -U postgres wcoen | gzip > backup-$(date +%F).gz`. Guarde `CHAVE_CRIPTO` fora do servidor: sem ela, as sessões do WhatsApp gravadas não abrem.
- **Testar antes de liberar um piloto:** `docs/roteiro-manual-portal.md`.

### Subir no Render (grátis)

1. Crie o projeto no Supabase (https://supabase.com), copie a "Connection string" (URI) do banco em
   Project Settings → Database, e acrescente `?sslmode=require` no final.
2. Gere `CHAVE_CRIPTO` (comando no `.env.example`) e escolha um `CONVITE`.
3. Crie a conta em https://render.com e conecte sua conta do GitHub.
4. No dashboard, "New" → "Blueprint", aponte para este repositório (usa o `Dockerfile` e o `render.yaml`
   já existentes; o `render.yaml` já pede as variáveis abaixo na criação, sem deixá-las no arquivo).
5. Preencha as variáveis pedidas: `DATABASE_URL` (a connection string do Supabase, com `?sslmode=require`),
   `CONVITE`, `CHAVE_CRIPTO`, `ADMIN_EMAILS`, e opcionalmente `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`.
   Deixe `DOMINIO` vazio por enquanto — o Render só mostra a URL do serviço depois de criado.
6. Depois do primeiro deploy, copie a URL que o Render atribuiu (algo como `wcoen.onrender.com`), volte em
   Environment e defina `DOMINIO` com ela (sem `https://`); o serviço reinicia sozinho.
7. Acesse `https://SEU-SERVICO.onrender.com`, cadastre-se com o convite e conecte o WhatsApp.

O plano gratuito do Render hiberna o serviço depois de um tempo sem tráfego HTTP; o app já faz um
"auto-ping" nele mesmo a cada 10 minutos quando `DOMINIO` está definido, então não deveria hibernar em uso
normal (esse comportamento de hibernação é observado, não uma garantia documentada do Render — se
notar quedas, considere um plano pago).

Backup do Supabase: veja Database → Backups no painel do projeto (o plano gratuito guarda alguns dias).
