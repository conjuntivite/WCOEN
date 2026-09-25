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
| Trocar para número dedicado | Só o adaptador WhatsApp muda: novo QR code, número no grupo, `GROUP_ID` no `.env` |

**Risco aceito:** bibliotecas não-oficiais violam os termos do WhatsApp e há risco de banimento do número. Mitigações: o bot só responde ao que o usuário manda, ignora qualquer outro grupo/conversa, aplica um pequeno atraso antes de responder e reconecta com espera crescente, sem loops agressivos. Os dados ficam no Mongo, independentes do WhatsApp.

## Arquitetura

```
src/
  whatsapp.ts   adaptador: Baileys, filtro do grupo, envio de respostas
  parser.ts     função pura: texto -> comando (sem I/O)
  service.ts    executa o comando e devolve o texto da resposta
  repo.ts       interface + implementação Mongo (add, desfazer, somar)
  config.ts     variáveis de ambiente (GROUP_ID, MONGO_URI)
  index.ts      liga tudo
```

O núcleo (`parser`, `service`) não conhece o WhatsApp. O `repo` é uma interface, então o `service` é testável com um repositório falso.

### Fluxo de uma mensagem

1. O Baileys recebe a mensagem; `whatsapp.ts` descarta tudo que não for texto do grupo configurado.
2. Normaliza para `{ msgId, remetente, texto, data }` e chama o `service`.
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
  criadoEm: Date,         // UTC; data original da mensagem
  desfeitoEm: Date | null }
```

Índices: `msgId` único (idempotência), `criadoEm`. Desfazer não apaga: marca `desfeitoEm`. O balancete ignora lançamentos desfeitos.

## Comandos (sem diferença entre maiúsculas e minúsculas)

| Entrada | Resultado |
|---|---|
| `mercado 45,90` | Despesa. O último termo é o valor; o resto é a conta (`conta de luz 120` → conta "conta de luz") |
| `+ salário 3000` | Receita. O `+` inicial marca receita (com ou sem espaço depois) |
| `balancete` | Balancete do mês atual |
| `balancete tudo` / `balancete 08/2026` | Todo o período / mês específico |
| `desfazer` | Desfaz o último lançamento não desfeito |
| `ajuda` | Lista os comandos |
| qualquer outra coisa | Ignorada em silêncio |

**Formatos de valor:** `45`, `45,90`, `45.90`, `1.234,56`, `R$ 45,90`. Valor zero, negativo ou ilegível: a mensagem é ignorada.

**Fuso:** limites de mês em `America/Sao_Paulo`; armazenamento em UTC.

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
- Adaptador WhatsApp: validação manual no grupo, sem teste automatizado.

## Fora do escopo (YAGNI)

Iniciar o bot com o Windows, editar lançamentos antigos, categorias, relatórios em PDF, multiusuário, monitoramento externo (ex.: healthchecks.io, útil quando for para um servidor).
