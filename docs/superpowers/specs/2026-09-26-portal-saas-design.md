# WCOEN como SaaS: portal web e sessões por cliente

Data: 2026-09-26 · Status: aguardando revisão

## Objetivo

Transformar o bot (hoje: um número, um grupo, configurado por `.env` e terminal) em um serviço hospedado por nós: o cliente se cadastra num site, conecta o próprio WhatsApp (QR ou código de pareamento), escolhe o grupo onde o bot responde e passa a usar os comandos atuais.

Primeira fase: **até ~20 clientes-piloto**, um servidor, um processo. Transporte: **Baileys** (não oficial). A comercialização em escala usará a **API oficial paga** do WhatsApp; por isso o transporte fica atrás de uma interface (ver "Ponto de costura").

## Fora de escopo (sub-projetos futuros)

Cobrança e planos · recuperação de senha por e-mail · painel administrativo · histórico/gráficos para o cliente · vários workers · API oficial do WhatsApp · política de privacidade e auditoria LGPD/segurança (a cargo do dono do produto, antes de sair dos pilotos).

## Decisões já tomadas

| Tema | Decisão |
|---|---|
| Modelo | SaaS hospedado por nós |
| Onde o cliente digita | Grupo escolhido no portal (como hoje) |
| Escala inicial | até ~20 clientes, um processo |
| Arquitetura | Monólito Node: HTTP + gerenciador de sessões + portal server-rendered |
| Cadastro | Fechado por código de convite (`CONVITE`) |
| Senha esquecida | Sem fluxo por e-mail; reset manual por script |
| Mensagens "Bot online/desligando" | Removidas; uma boas-vindas ao escolher o grupo |

## Componentes

| Arquivo | Responsabilidade |
|---|---|
| `src/sessoes.ts` | Gerenciador: uma conexão por conta. Estado, QR atual, código de pareamento, lista de grupos, definir grupo, desconectar. Herda de `whatsapp.ts` a fila sequencial, anti-loop, mensagens recuperadas e backoff (`backoff.ts`), **sem `process.exit`**. |
| `src/authstate.ts` | Estado de autenticação do Baileys no Mongo, por conta, criptografado em repouso. Substitui `useMultiFileAuthState`. |
| `src/contas.ts` | Cadastro, login, hash de senha (`scrypt`), grupo escolhido, limite de tentativas. |
| `src/web.ts` | Servidor HTTP e páginas renderizadas no servidor (sem framework de front). |
| `src/repo.ts` | `conectarMongo` passa a expor `repoDe(contaId)`. A interface `Repo` **não muda**. |
| `src/index.ts` | Sobe Mongo, gerenciador e web; reabre as sessões das contas com credenciais, escalonadas. |
| `Service`, `parser`, `presentation`, `period`, `money` | **Sem alteração.** O gerenciador cria um `Service` por conta. |

Dependência nova: uma biblioteca pequena para gerar o QR como imagem/SVG no navegador. O restante usa stdlib e o que já está instalado.

## Ponto de costura (API oficial no futuro)

O gerenciador depende de uma fábrica de sockets injetável (`criarSocket`), usada também nos testes. Trocar Baileys pela API oficial exigirá um novo adaptador de transporte (webhooks em vez de socket, cadastro incorporado em vez de QR), sem tocar em `Service`, `Repo` nem nas mensagens. Não se cria abstração além dessa fábrica agora.

## Fluxo do cliente

1. Cadastra (e-mail, senha, código de convite) e entra.
2. `/painel` → **Conectar**: o gerenciador abre um socket sem credenciais; o QR chega ao navegador por SSE. Alternativa: informar o número com DDI e receber um código de 8 caracteres (para quem abre o portal no próprio celular).
3. Depois do pareamento, o painel lista os grupos; o cliente escolhe um.
4. O bot envia uma mensagem de boas-vindas ("✅ Conectado! Digite *ajuda* para ver os comandos") e passa a processar comandos como hoje.

O painel mostra apenas o passo atual: **Conectar → Escolher grupo → Pronto** (resumo de comandos, *Trocar grupo*, *Desconectar*).

## Estados e falhas

Estados por conta: `desconectado` → `aguardando_qr` → `conectando` → `conectado`.

| Situação | Comportamento |
|---|---|
| QR não escaneado | Renova por ~2 min; depois fecha o socket e volta a `desconectado`. |
| Código 515 após escanear | Recria o socket automaticamente, como parte do pareamento (não é erro). |
| Conectado sem grupo | Lista os grupos; **nenhuma mensagem é processada** até escolher. |
| Queda de rede | Reconecta com `atrasoReconexao`; painel mostra "reconectando". |
| `loggedOut` (aparelho removido no celular) | Apaga as credenciais da conta; `desconectado` com aviso. |
| `connectionReplaced` | `desconectado`, **sem retry automático**, com aviso. |
| Reinício do servidor | Reabre contas com credenciais, uma a cada poucos segundos; mensagens offline entram na lógica de "recuperadas", por conta. |
| Erro numa conta | Isolado: registrado com o `contaId`, nunca derruba o processo nem outras contas. |
| Mais contas que `MAX_SESSOES` | As excedentes ficam `desconectado` com aviso "servidor lotado". |

Código de pareamento e QR são credenciais temporárias: trafegam só pelo SSE autenticado da própria conta e nunca vão para log.

## Dados (Mongo)

| Coleção | Conteúdo |
|---|---|
| `contas` | `email` (único, minúsculo), `senhaHash`, `grupoId`, `grupoNome`, `criadaEm` |
| `logins` | id aleatório de sessão do navegador; TTL de 30 dias |
| `wa_auth` | credenciais e chaves do Baileys por conta, criptografadas com AES-256-GCM (chave `CHAVE_CRIPTO` do `.env`) |
| `lancamentos` | ganha `contaId`; índices únicos `(contaId, msgId)` e `(contaId, data)` |

**Migração:** `npm run migrar -- <email>` atribui o `contaId` da conta indicada aos lançamentos existentes e recria os índices. Idempotente.

## Autenticação e segurança

- Senha com `scrypt` (`node:crypto`). Cookie `httpOnly`, `SameSite=Lax`, `Secure`.
- Limite de tentativas de login por IP e por e-mail (em memória; suficiente para pilotos).
- Mutações só por `POST`, com verificação de `Origin`.
- Isolamento: toda rota resolve a conta pelo cookie; SSE e ações operam só na conta autenticada.
- Credenciais do WhatsApp nunca em claro no banco nem em log.

## Rotas

`GET /entrar` · `GET /cadastro` · `POST /entrar` · `POST /cadastro` · `GET /painel` · `GET /painel/eventos` (SSE) · `POST /painel/conectar` · `POST /painel/parear` · `POST /painel/grupo` · `POST /painel/desconectar` · `POST /sair`

## Empacotamento

`Dockerfile` (Node, `npm ci`, executa com `tsx` como hoje, sem etapa de build) e `docker-compose.yml` com: app, Mongo com volume persistente e Caddy (HTTPS automático). `.env.example` ampliado: `MONGO_URI`, `MONGO_DB`, `CONVITE`, `CHAVE_CRIPTO`, `DOMINIO`, `PORTA`, `MAX_SESSOES` (padrão 20), além das variáveis do OpenRouter. Subir: `docker compose up -d`. Backup com `mongodump` documentado no README.

## Testes

Vitest, contra o Mongo do Docker onde precisar de banco (padrão atual do projeto).

- **Gerenciador:** socket falso injetado. QR → `aguardando_qr`; 515 recria o socket; `loggedOut` apaga credenciais; `connectionReplaced` não tenta de novo; sem grupo não processa; erro numa conta não afeta as outras; `MAX_SESSOES`.
- **`authstate`:** grava/lê de volta; o documento bruto no Mongo não contém o texto das credenciais.
- **Isolamento entre contas:** mesmo `msgId` em duas contas não colide; balancete de uma nunca soma lançamentos de outra (o teste de contrato do `Repo` roda com duas contas).
- **Contas e portal:** cadastro, e-mail duplicado, convite inválido, senha errada, limite de tentativas, rota protegida sem login, `Origin` inválido, SSE da conta A nunca entrega eventos da conta B.
- **Migração:** sobre dados fictícios, incluindo reexecução.
- **Manual (WhatsApp real):** roteiro com número de teste — escanear, escolher grupo, comandos, matar o servidor e conferir a recuperação.

## Riscos aceitos nesta fase

- Baileys é não oficial: o WhatsApp pode banir números. Aceito nos pilotos; a API oficial substitui na comercialização.
- Dados financeiros de terceiros e credenciais de WhatsApp em nossa base: auditoria de segurança e adequação à LGPD ficam a cargo do dono do produto antes de sair dos pilotos. A auditoria com IA envia dados ao OpenRouter e deve constar na política de privacidade.
