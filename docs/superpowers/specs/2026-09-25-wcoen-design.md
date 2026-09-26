# WCOEN — Balancete pessoal pelo WhatsApp (design)

Data: 2026-09-25 (atualizada em 2026-09-26)

## Objetivo

Registrar despesas e receitas por mensagens de texto num grupo do WhatsApp (só o usuário) e gerar um balancete (receitas − despesas por conta). Sem a API oficial do WhatsApp (paga).

**Sucesso:** digitar `mercado 45,90` no grupo e receber a confirmação; digitar `balancete` e ver os movimentos do dia; digitar `balancete mensal` e ver o resumo dos meses.

## Decisões

| Tema | Decisão |
|---|---|
| Canal | Grupo do WhatsApp só do usuário, com o bot num **número dedicado** (participante do grupo) |
| Integração | Biblioteca não-oficial (Baileys), sem API paga |
| Usuários | Só o dono. O remetente é gravado em cada lançamento para permitir multiusuário depois sem migração |
| Execução | PC Windows do usuário, processo único |
| Stack | Node.js + TypeScript + Baileys |
| Banco | MongoDB existente do usuário (Docker), banco separado `wcoen` |
| Comandos | Texto livre para lançar; `balancete` (dia), `balancete mensal\|semanal\|anual` (resumos) e `auditoria` para consultar |
| IA (opcional) | OpenRouter, só na `auditoria` (sugestões sobre números calculados em código); **somente modelos pagos**, sem fallback gratuito; chamada via `fetch` nativo; desligada sem chave |
| Trocar para número dedicado | Só o adaptador WhatsApp muda: novo QR code, número no grupo, `GROUP_ID` no `.env` |

**Risco aceito:** bibliotecas não-oficiais violam os termos do WhatsApp e há risco de banimento do número. Mitigações: o bot só responde ao que o usuário manda, ignora qualquer outro grupo/conversa, aplica um pequeno atraso antes de responder e reconecta com espera crescente, sem loops agressivos. Os dados ficam no Mongo, independentes do WhatsApp.

## Arquitetura

```
src/
  whatsapp.ts   adaptador: Baileys, filtro do grupo, envio de respostas
  parser.ts     função pura: texto -> comando (sem I/O)
  auditar.ts    interface Auditor + cliente OpenRouter (opcional)
  service.ts    executa o comando e devolve o texto da resposta
  repo.ts       interface + implementação Mongo (add, desfazer, extrato, somar)
  config.ts     variáveis de ambiente (GROUP_ID, MONGO_URI, OPENROUTER_API_KEY/MODEL opcionais)
  index.ts      liga tudo
```

O núcleo (`parser`, `service`) não conhece o WhatsApp. O `repo` é uma interface, então o `service` é testável com um repositório falso.

### Fluxo de uma mensagem

1. O Baileys recebe a mensagem; `whatsapp.ts` descarta tudo que não for texto do grupo configurado.
2. Normaliza para `{ msgId, remetente, texto, enviadoEm }` e chama o `service`.
3. O `parser` transforma o texto em comando: lançamento, balancete, auditoria, desfazer, ajuda, dica de uso ou ignorar.
4. O `service` chama o `repo` e monta a resposta (ex.: `🔴 *Despesa* · mercado · R$ 45,90`; receita usa `🟢`; com data informada termina em ` · 📅 09/09`; desfazer: `↩️ *Desfeito* · mercado · R$ 45,90`).
5. O adaptador envia a resposta ao grupo com um pequeno atraso.

### Anti-loop

O bot roda no número do usuário, então as respostas dele chegam como mensagens do próprio número. O adaptador guarda os IDs das mensagens enviadas pelo bot e as ignora.

### Descoberta do ID do grupo

Enquanto `GROUP_ID` estiver vazio, o bot só loga os grupos que enxerga (nome e ID) e não processa mensagens. O usuário copia o ID certo para o `.env`.

## Modelo de dados

Coleção `lancamentos` (banco `wcoen`):

```
{ tipo: "despesa" | "receita",
  conta: string,          // minúsculas, sem espaços sobrando; chave de agrupamento
  valor: number,          // centavos, inteiro
  remetente: string,      // JID do remetente
  msgId: string,          // ID da mensagem do WhatsApp
  data: Date,             // UTC; dia do lançamento: o informado pelo usuário ou, sem ele, a data de envio da mensagem
  enviadoEm: Date,        // UTC; quando a mensagem foi enviada (ordena o desfazer)
  desfeitoEm: Date | null }
```

Índices: `msgId` único (idempotência), `data`. Os relatórios filtram por `data`; o `desfazer` ordena por `enviadoEm`, então desfaz o último lançamento **enviado** mesmo que sua `data` seja antiga. Desfazer não apaga: marca `desfeitoEm`. Os relatórios ignoram lançamentos desfeitos.

## Comandos (sem diferença entre maiúsculas e minúsculas)

| Entrada | Resultado |
|---|---|
| `mercado 45,90` | Despesa. O último termo é o valor; o resto é a conta (`conta de luz 120` → conta "conta de luz") |
| `+ salário 3000` / `+ 70 plantão` | Receita. O `+` inicial marca receita (com ou sem espaço depois) e o valor pode vir depois ou antes da descrição |
| `salário 3000`, `plantão vogue 40`, `venda beck 120` | Receita **sem sinal**: se a descrição começa com uma palavra de receita (sem diferenciar acento nem maiúsculas: salário, décimo terceiro, plantão, freela, freelance, comissão, bônus, venda, vendas, reembolso, rendimento(s), pró-labore), o lançamento é receita. Vale só a palavra inteira no começo (`vendaval 50` e `pix salário 100` seguem despesa). **O sinal explícito sempre vence** (`- salário 100` é despesa, `+ mercado 50` é receita). Palavras ambíguas (`pix`, `pagamento`, `aluguel`) ficam de fora: para elas vale o `+` |
| `- 130 role na avenida` / `- role 130` | Despesa. O `-` inicial marca despesa, com as mesmas duas ordens. A descrição vira o nome da conta (até 40 caracteres, começando com letra). Sem sinal, `mercado 45,90` continua sendo despesa com o valor no fim |
| `balancete` / `balancete hoje` | Os movimentos **de hoje** (dia, hora do envio, valor e descrição) e o total do dia |
| `balancete mensal` | Resumo (receitas, despesas e saldo) do mês atual e dos anteriores, até 12 meses, só os com movimento |
| `balancete semanal` | Resumo da semana atual (domingo a sábado) e das 3 anteriores, só as com movimento |
| `balancete anual` | Resumo do ano atual e dos 4 anteriores, só os com movimento |
| `extrato` / `extrato N` | Todos os lançamentos, do mais recente ao mais antigo, **20 por página**; `extrato N` mostra a página N. O bot não manda várias mensagens: no fim de cada página diz qual comando digitar para a próxima |
| `auditoria` / `auditoria mensal\|semanal\|anual` | Ranking dos maiores gastos e comparação com o período anterior (calculados em código) e sugestões da IA (opcional; ver *Auditoria com IA*) |
| `balancete <outra coisa>` / `auditoria <outra coisa>` | Dica de uso (os comandos antigos `trimestre`, `tudo`, `receitas`, `despesas`, `<conta>` e `ia` não existem mais) |
| `desfazer` | Desfaz o último lançamento enviado que não foi desfeito |
| `ajuda` | Lista os comandos |
| qualquer outra coisa | Ignorada em silêncio |

**Formatos de valor:** `45`, `45,90`, `45.90`, `1.234,56`, `R$ 45,90`. Valor zero, negativo ou ilegível: a mensagem é ignorada.

**Fuso:** limites de mês e de semana em `America/Sao_Paulo`; armazenamento em UTC.

**Balancete do dia:** `balancete` (ou `balancete hoje`) mostra os movimentos de **hoje** (dia local, -03:00), em duas linhas por lançamento para não quebrar no celular: `*dd/mm às HH:mm*` em cima (a data é a do lançamento e a hora é a do **envio** da mensagem) e `🟢/🔴 R$ valor · descrição` embaixo; depois o total do dia (receitas, despesas e saldo). Sem lançamentos: `Sem lançamentos hoje.`

**Resumos:** `balancete mensal`, `balancete semanal` e `balancete anual` mostram **apenas** receitas, despesas e saldo de cada período, sem extrato. Cada período tem o `*rótulo*` e depois três linhas, `🟢 R$ …`, `🔴 R$ …` e `💰 R$ …` (um item por linha, com o ícone junto do valor), e os períodos ficam separados por linha em branco, do mais recente ao mais antigo.

- **Mensal:** o mês atual e os anteriores, até 12 (o atual incluído); rótulo `MM/AAAA`.
- **Semanal:** a semana atual (domingo 00:00 a sábado 23:59) e as 3 anteriores; rótulo `dd/mm a dd/mm`.
- **Anual:** o ano atual e os 4 anteriores; rótulo `AAAA`.
- Períodos sem movimento não aparecem. Nenhum movimento em nenhum período: `Sem lançamentos no período.` Lançamentos desfeitos nunca aparecem.
- Qualquer outro texto depois de `balancete` responde `⚠️ Use *balancete*, *balancete mensal*, *balancete semanal* ou *balancete anual*.`

**Extrato paginado:** `extrato` (página 1) e `extrato N` (página N). Ordem estritamente decrescente: `data` do lançamento, depois `enviadoEm`, depois ordem de inserção (do mais recente ao mais antigo). 20 lançamentos por página; cada lançamento em duas linhas (`*dd/mm às HH:mm*` e `🟢/🔴 R$ valor · descrição`). A página 1 traz, no topo, os **totais gerais** (receitas, despesas e saldo de todos os lançamentos); as demais só os lançamentos. Rodapé: `➡️ Próxima página: digite *extrato 2*` quando há mais páginas; `✅ Fim do extrato` na última (quando há mais de uma). Página além do fim: `⚠️ O extrato tem só N página(s). Digite *extrato* para começar.` Sem lançamentos: `Sem lançamentos.` Formas inválidas (`extrato 0`, `extrato abc`, `extrato 2 3`): `⚠️ Use *extrato* ou *extrato 2* (o número da página).` `extrato` é palavra reservada (`extrato 500` é pedido de página, nunca despesa). O extrato completo é carregado do banco e recortado a cada pedido (adequado a um bot pessoal).

**Data do lançamento:** só é considerada quando o usuário a informa. Sem data, vale a data de envio da mensagem. Para informar, escreva no fim do lançamento: `hoje`, `ontem`, `anteontem`, `dd/mm` ou `dd/mm/aaaa` (ex.: `+ plantão 450 ontem`, `mercado 45,90 15/09`). A confirmação de lançamento com data mostra o dia (`🟢 *Receita* · plantão · R$ 450,00 · 📅 09/09`); sem data, não mostra. Sem ano, usa o ano da mensagem; se isso cair no futuro, usa o ano anterior. Data futura explícita ou inexistente (`29/02/2026`) é recusada com `⚠️ Data inválida ou no futuro, não lancei`, sem lançar. O lançamento com data fica no meio-dia local do dia informado. Datas relativas contam a partir do dia em que a mensagem foi enviada.

**Risco conhecido:** frases que terminam em número (ex.: "reunião às 15") viram lançamento. Mitigação: toda resposta confirma o que foi lançado e `desfazer` corrige.

**Exemplo de `balancete`** (o dia):

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

**Exemplo de `balancete mensal`:**

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

## Auditoria com IA (opcional)

`auditoria` (= `auditoria mensal`), `auditoria semanal` e `auditoria anual`. A IA **só é chamada por esse comando**. O relatório traz os totais, o ranking dos até 5 maiores gastos (com percentual), a comparação com o período anterior (mês, semana ou ano anterior; variação em % só quando o anterior é maior que zero) e uma lista de 3 a 5 sugestões da IA.

- **Números em código, IA só escreve:** totais, ranking e comparação são calculados pelo sistema (centavos inteiros). A IA recebe o resumo já calculado (e até os 200 lançamentos mais recentes) e devolve só texto. Ela nunca grava nada nem faz conta.
- **Privacidade:** a auditoria envia **valores, datas e descrições** das contas ao OpenRouter. Isso só acontece para os modelos listados em `OPENROUTER_MODEL` (pagos); **não há fallback para modelos gratuitos**. A chave nunca aparece em log, erro, corpo da requisição ou resposta.
- **Configuração:** `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` (um ou mais modelos separados por vírgula, em ordem de tentativa) no `.env`. Sem chave, `auditoria` responde `A IA não está configurada (defina OPENROUTER_API_KEY e OPENROUTER_MODEL no .env).`
- **Cliente:** `fetch` nativo, `temperature: 0.3`, timeout de 30 s por tentativa e prazo total de 45 s; cada modelo é tentado uma vez, na ordem. Conta como falha: erro de rede, HTTP não-OK, timeout, conteúdo ausente ou resposta sem sugestões utilizáveis. Cada falha vira um aviso no terminal (sem a chave).
- **Sanitização:** o texto da IA passa por `limparSugestoes` (tira marcadores no início da linha, mas só exige marcador numerado seguido de espaço, para não mutilar valores como `1.500`; corta cada sugestão em 200 caracteres; no máximo 5). A resposta sempre tem várias linhas e começa com emoji, então **nunca** pode ser lida de volta como comando.
- **Falhas:** sem lançamentos no período: `Sem lançamentos no período.` (sem chamar a IA). Se a IA falhar ou vier vazia, o relatório calculado sai normalmente e termina com `💡 *Sugestões da IA*` / `Indisponível agora, tente de novo.`
- **Limite conhecido:** a auditoria pode segurar a fila de mensagens por até ~45 s; o que for digitado nesse intervalo espera (um desligamento nele pode perder essa mensagem).

**Exemplo** (sugestões da IA, números calculados):

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

## Estado do bot: avisos e recuperação

- **Ao ligar:** manda `🤖 Bot online` no grupo.
- **Ao desligar de forma normal** (SIGINT/SIGTERM): manda `🤖 Bot desligando` antes de sair. Não cobre queda de energia, travamento ou crash; nesses casos o `🤖 Bot online` seguinte indica que houve uma pausa.
- **Recuperação de mensagens offline:** ao reconectar, o WhatsApp costuma entregar as mensagens do grupo enviadas com o bot desligado. O bot as processa (o `msgId` único evita duplicidade) usando a **data original** da mensagem, e responde algo como `📥 Recuperei 3 lançamentos feitos enquanto eu estava offline`. Extra, sem garantia de por quanto tempo o WhatsApp retém as mensagens; se não houver resposta, o usuário deve assumir que não foi registrado.

## Erros e reconexão

- **Primeira execução:** QR code no terminal; sessão em `./auth` (fora do git).
- **Queda de conexão:** reconecta com espera crescente (1s até 60s).
- **Sessão invalidada** (aparelho desconectado): o bot para e loga "apague `./auth` e escaneie de novo". Sem loop de tentativas.
- **Mensagens repetidas:** `msgId` único garante idempotência.
- **Mongo fora do ar na partida:** falha imediata com mensagem clara.
- **Falha ao gravar durante o uso:** responde `⚠️ Não consegui salvar, tente de novo`. A confirmação (`🟢`/`🔴`) só é enviada depois da gravação confirmada.
- **Erro inesperado:** `try/catch` por mensagem; loga, responde erro genérico e o processo continua.

## Testes (Vitest)

- `parser`: tabela de casos (valores, sinais `+`/`-` com o valor antes ou depois, datas, relatórios, dica de uso, frases ignoradas, respostas do próprio bot que nunca podem virar comando).
- `service`: repositório em memória; lançar, desfazer, recuperação, os três relatórios e a auditoria com strings exatas (`toBe`).
- `repo`: suíte de contrato compartilhada entre `MemoryRepo` e `MongoRepo` (este contra o Mongo real, banco `wcoen_test`), incluindo `extrato` e `desfazer`.
- `auditar`: `limparSugestoes` e o cliente OpenRouter com `fetch` falso (URL, chave só no header, só modelos configurados, falhas, sem vazar a chave). Nenhum teste chama a rede.
- Adaptador WhatsApp: validação manual no grupo, sem teste automatizado.

## Fora do escopo (YAGNI)

Iniciar o bot com o Windows, editar lançamentos antigos, filtro por conta ou por natureza no balancete, aviso de "processando" durante a auditoria, categorias, relatórios em PDF, multiusuário, monitoramento externo (ex.: healthchecks.io, útil quando for para um servidor).
