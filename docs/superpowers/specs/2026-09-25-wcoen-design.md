# WCOEN — Balancete pessoal pelo WhatsApp (design)

Data: 2026-09-25

## Objetivo

Registrar despesas e receitas por mensagens de texto num grupo do WhatsApp (só o usuário) e gerar um balancete (receitas − despesas por conta). Sem a API oficial do WhatsApp (paga).

**Sucesso:** digitar `mercado 45,90` no grupo e receber a confirmação; digitar `balancete` e ver o resumo do mês.

## Decisões

| Tema | Decisão |
|---|---|
| Canal | Grupo do WhatsApp só do usuário, no número principal dele |
| Integração | Biblioteca não-oficial (Baileys), sem API paga |
| Usuários | Só o dono. O remetente é gravado em cada lançamento para permitir multiusuário depois sem migração |
| Execução | PC Windows do usuário, processo único |
| Stack | Node.js + TypeScript + Baileys |
| Banco | MongoDB existente do usuário (Docker), banco separado `wcoen` |
| Comandos | Texto livre, sem prefixo obrigatório |
| IA (opcional) | OpenRouter, só para agrupar contas por tema e **só quando o usuário pede** (`balancete ia carro`); chamada via `fetch` nativo; desligada sem chave |
| Trocar para número dedicado | Só o adaptador WhatsApp muda: novo QR code, número no grupo, `GROUP_ID` no `.env` |

**Risco aceito:** bibliotecas não-oficiais violam os termos do WhatsApp e há risco de banimento do número. Mitigações: o bot só responde ao que o usuário manda, ignora qualquer outro grupo/conversa, aplica um pequeno atraso antes de responder e reconecta com espera crescente, sem loops agressivos. Os dados ficam no Mongo, independentes do WhatsApp.

## Arquitetura

```
src/
  whatsapp.ts   adaptador: Baileys, filtro do grupo, envio de respostas
  parser.ts     função pura: texto -> comando (sem I/O)
  agrupar.ts    interface Agrupador + cliente OpenRouter (opcional)
  service.ts    executa o comando e devolve o texto da resposta
  repo.ts       interface + implementação Mongo (add, desfazer, somar)
  config.ts     variáveis de ambiente (GROUP_ID, MONGO_URI, OPENROUTER_API_KEY/MODEL opcionais)
  index.ts      liga tudo
```

O núcleo (`parser`, `service`) não conhece o WhatsApp. O `repo` é uma interface, então o `service` é testável com um repositório falso.

### Fluxo de uma mensagem

1. O Baileys recebe a mensagem; `whatsapp.ts` descarta tudo que não for texto do grupo configurado.
2. Normaliza para `{ msgId, remetente, texto, enviadoEm }` e chama o `service`.
3. O `parser` transforma o texto em comando: despesa, receita, balancete, desfazer, ajuda ou ignorar.
4. O `service` chama o `repo` e monta a resposta (ex.: `✅ Despesa: mercado R$ 45,90`).
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

Índices: `msgId` único (idempotência), `data`. O balancete filtra por `data`; o `desfazer` ordena por `enviadoEm`, então desfaz o último lançamento **enviado** mesmo que sua `data` seja antiga. Desfazer não apaga: marca `desfeitoEm`. O balancete ignora lançamentos desfeitos.

## Comandos (sem diferença entre maiúsculas e minúsculas)

| Entrada | Resultado |
|---|---|
| `mercado 45,90` | Despesa. O último termo é o valor; o resto é a conta (`conta de luz 120` → conta "conta de luz") |
| `+ salário 3000` / `+ 70 plantão` | Receita. O `+` inicial marca receita (com ou sem espaço depois) e o valor pode vir depois ou antes da descrição |
| `- 130 role na avenida` / `- role 130` | Despesa. O `-` inicial marca despesa, com as mesmas duas ordens. A descrição vira o nome da conta (até 40 caracteres, começando com letra). Sem sinal, `mercado 45,90` continua sendo despesa com o valor no fim |
| `balancete` | Balancete do mês atual |
| `balancete tudo` / `balancete 08/2026` | Todo o período / mês específico |
| `balancete semana` / `balancete semana passada` | Semana atual / anterior (segunda a domingo) |
| `balancete trimestre` | Os 3 meses **fechados** anteriores ao mês atual (em 20/06: março, abril e maio) |
| `balancete ano` / `balancete 2025` | Ano do calendário atual / um ano específico |
| `balancete receitas` / `balancete despesas` | Só receitas / só despesas (mês atual) |
| `balancete mercado` | Só a conta "mercado" (mês atual): total de receitas e de despesas dessa conta |
| `balancete ia carro` | Soma, por IA, as contas do período relacionadas a "carro" (opcional: precisa do OpenRouter; ver *Agrupamento por IA*) |
| `desfazer` | Desfaz o último lançamento enviado que não foi desfeito |
| `ajuda` | Lista os comandos |
| qualquer outra coisa | Ignorada em silêncio |

**Formatos de valor:** `45`, `45,90`, `45.90`, `1.234,56`, `R$ 45,90`. Valor zero, negativo ou ilegível: a mensagem é ignorada.

**Fuso:** limites de mês e de semana em `America/Sao_Paulo`; armazenamento em UTC.

**Períodos e filtros combinam:** `balancete [período] [filtro]`. Período: nada (mês atual), `tudo`, `semana`, `semana passada`, `trimestre`, `ano`, `AAAA` ou `MM/AAAA`. Filtro: `receitas`, `despesas`, o nome de uma conta ou `ia <termo>`. Exemplos: `balancete semana despesas`, `balancete ano mercado`, `balancete trimestre receitas`, `balancete ano ia carro`. As palavras `tudo`, `semana`, `trimestre`, `ano`, `receitas` e `despesas` não funcionam como nome de conta no filtro, e `ia` como primeira palavra do filtro é reservada. O nome da conta precisa bater com o lançado; se não houver lançamentos: `Sem lançamentos no período.` Para agrupar contas por tema, use `ia` (seção *Agrupamento por IA*).

**Formato do balancete filtrado:**

```
📊 Balancete 09/2026 · despesas          📊 Balancete 09/2026 · mercado
Despesas: R$ 512,40                       Despesas: R$ 345,90
  mercado  345,90
  luz      166,50
```

Filtro por natureza mostra só aquele bloco, sem saldo. Filtro por conta mostra só o total (e, se a conta tiver receita e despesa, os dois totais e o saldo). Título do trimestre: `trimestre 06/2026 a 08/2026`; do ano: `2026`.

**Data do lançamento:** só é considerada quando o usuário a informa. Sem data, vale a data de envio da mensagem. Para informar, escreva no fim do lançamento: `hoje`, `ontem`, `anteontem`, `dd/mm` ou `dd/mm/aaaa` (ex.: `+ plantão 450 ontem`, `mercado 45,90 15/09`). A confirmação de lançamento com data mostra o dia (`✅ Receita: plantão R$ 450,00 (09/09)`); sem data, não mostra. Sem ano, usa o ano da mensagem; se isso cair no futuro, usa o ano anterior. Data futura explícita ou inexistente (`29/02/2026`) é recusada com `⚠️ Data inválida ou no futuro, não lancei`, sem lançar. O lançamento com data fica no meio-dia local do dia informado. Datas relativas contam a partir do dia em que a mensagem foi enviada.

**Risco conhecido:** frases que terminam em número (ex.: "reunião às 15") viram lançamento. Mitigação: toda resposta confirma o que foi lançado e `desfazer` corrige.

**Exemplo de balancete:**

```
📊 Balancete 09/2026
Receitas: R$ 3.000,00
  salário  3.000,00
Despesas: R$ 512,40
  mercado  345,90
  luz      166,50
Saldo: R$ 2.487,60
```

## Agrupamento por IA (opcional)

Quando o usuário **pede** com `ia` (`balancete ia carro`, `balancete ano ia carro`) e o OpenRouter está configurado, o bot pergunta à IA quais das contas existentes no período se relacionam com o termo. Ex.: `balancete ia carro` soma `gasolina`, `óleo`, `retífica`, `mecânico` e `peças`.

- **Só sob pedido:** `balancete carro` (sem `ia`) nunca chama a IA e soma apenas a conta "carro". Período sem nenhuma conta também não chama a IA. Sem OpenRouter configurado, `balancete ia carro` responde que a IA não está configurada.
- **Privacidade:** só o termo e os **nomes** das contas vão ao OpenRouter. Valores, datas e remetentes nunca saem da máquina.
- **Configuração:** `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` no `.env` (o usuário escolhe o modelo). Sem chave, o recurso fica desligado e o bot age como antes. Chamada com `fetch` nativo, `temperature: 0`, timeout de 15 s, sem dependência nova. O repositório ganha `contas(intervalo)` (nomes distintos de conta no período).
- **Fallback:** `OPENROUTER_MODEL` aceita vários modelos separados por vírgula (o primeiro é o preferido, pago); depois deles entram modelos gratuitos de reserva (lista padrão no código, substituível por `OPENROUTER_FALLBACK_MODELS`). Cada modelo é tentado uma vez, com timeout de 15 s e prazo total de 40 s. Conta como falha: erro de rede, HTTP não-OK (inclusive 429 dos gratuitos), timeout, conteúdo ausente ou resposta fora do combinado. Lista vazia **válida** (`{"contas": []}`) é resposta legítima e não aciona o fallback. Modelos gratuitos podem ser menos precisos e seguem as regras de dados do OpenRouter; o que é enviado continua sendo só o termo e os nomes das contas. Cada falha vira um aviso no terminal (sem a chave).
- **Contrato da resposta:** a IA devolve `{"contas": [...]}`. O bot aceita texto ou cerca de código em volta do JSON e descarta qualquer nome que não esteja na lista enviada (sem diferenciar maiúsculas). O prompt manda a IA ser conservadora: na dúvida, não incluir a conta.
- **Formato:**

```
📊 Balancete 09/2026 · carro (agrupado por IA)
Despesas: R$ 420,00
  gasolina  300,00
  óleo      120,00
```

  Lista as contas incluídas, mostra os blocos que existirem e o saldo quando houver receita e despesa.
- **Falhas:** se todos os modelos falharem (rede, HTTP, timeout, resposta fora do combinado), responde `Não consegui agrupar agora, tente de novo.`; nenhuma conta relacionada responde `Não achei contas relacionadas a "carro" no período.` Nunca vira exceção para o usuário.
- **Limite conhecido:** a IA pode errar (incluir ou esquecer uma conta). O aviso `(agrupado por IA)` e a lista visível permitem conferir; para corrigir, lançar com nome mais claro.

## Estado do bot: avisos e recuperação

- **Ao ligar:** manda `🟢 Bot online` no grupo.
- **Ao desligar de forma normal** (SIGINT/SIGTERM): manda `🔴 Bot desligando` antes de sair. Não cobre queda de energia, travamento ou crash; nesses casos o `🟢` seguinte indica que houve uma pausa.
- **Recuperação de mensagens offline:** ao reconectar, o WhatsApp costuma entregar as mensagens do grupo enviadas com o bot desligado. O bot as processa (o `msgId` único evita duplicidade) usando a **data original** da mensagem, e responde algo como `📥 Recuperei 3 lançamentos feitos enquanto eu estava offline`. Extra, sem garantia de por quanto tempo o WhatsApp retém as mensagens; se não houver resposta, o usuário deve assumir que não foi registrado.

## Erros e reconexão

- **Primeira execução:** QR code no terminal; sessão em `./auth` (fora do git).
- **Queda de conexão:** reconecta com espera crescente (1s até 60s).
- **Sessão invalidada** (aparelho desconectado): o bot para e loga "apague `./auth` e escaneie de novo". Sem loop de tentativas.
- **Mensagens repetidas:** `msgId` único garante idempotência.
- **Mongo fora do ar na partida:** falha imediata com mensagem clara.
- **Falha ao gravar durante o uso:** responde `⚠️ Não consegui salvar, tente de novo`. O ✅ só é enviado depois da gravação confirmada.
- **Erro inesperado:** `try/catch` por mensagem; loga, responde erro genérico e o processo continua.

## Testes (Vitest)

- `parser`: tabela de casos (formatos de valor, `+`, conta com várias palavras, frases ignoradas).
- `service`: repositório falso em memória; cobre lançar, desfazer, recuperação de mensagens e texto do balancete.
- `repo` Mongo: teste de integração da agregação, em banco `wcoen_test` no Mongo em Docker.
- `agrupar`: leitura da resposta da IA (JSON limpo, com texto ou cerca em volta, nomes inventados, lixo) e cliente OpenRouter com `fetch` falso (URL, chave, só nomes no corpo, erro HTTP, fallback entre modelos, lista vazia que não aciona o fallback, aviso sem vazar a chave). Nenhum teste chama a rede.
- `service`: com um agrupador falso (escolhe, não escolhe, falha, IA desligada, conta comum que nunca chama a IA, período vazio).
- Adaptador WhatsApp: validação manual no grupo, sem teste automatizado.

## Fora do escopo (YAGNI)

Iniciar o bot com o Windows, editar lançamentos antigos, sugestão de contas parecidas quando o filtro não acha nada, contagem de lançamentos no balancete, categorias, relatórios em PDF, multiusuário, monitoramento externo (ex.: healthchecks.io, útil quando for para um servidor).
