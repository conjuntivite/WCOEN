# Esqueci a senha, conta DEV e administração de contas

## Objetivo
1. Self-service: link "Esqueci minha senha" na tela de login, com redefinição por e-mail.
2. Conta DEV: recuperação/suporte, semeada por variável de ambiente, sem tabela de papéis nova.
3. Tela de administração de contas (dentro de `/admin`): listar e-mails cadastrados, desativar/reativar,
   disparar o link de redefinição para qualquer conta, e (só a conta DEV) excluir definitivamente.

## Decisões
- E-mail transacional via SMTP com `nodemailer` (única dependência nova — Node não tem cliente SMTP na
  stdlib; mesmo motivo documentado no projeto irmão SPECIUM). Configuração só por `.env`, sem tela de
  admin dinâmica (o WCOEN não tem esse padrão hoje; todo config de infra já é por `.env` — ver `config.ts`).
- Sem SMTP configurado, o link cai no console do servidor em vez de falhar — mesmo comportamento do
  auditor de IA quando falta `OPENROUTER_API_KEY`.
- Link do e-mail não precisa de `APP_URL` novo: usa `req.headers.host` + o `cookieSeguro` que já existe.
- Resposta do "esqueci a senha" é sempre genérica (não revela se o e-mail existe), reaproveitando o
  `limitador` já usado em `/entrar` e `/cadastro` com um prefixo de chave novo.
- Conta DEV: mesmo padrão do SPECIUM (conta de recuperação semeada do `.env`, oculta da listagem), mas
  sem coluna de "papel" — reconhecida só comparando o e-mail da sessão com `DEV_EMAIL`, do mesmo jeito
  que `ADMIN_EMAILS` já decide quem vê `/admin`.
- Desativar uma conta também desconecta o WhatsApp na hora (reaproveita `sessoes.desconectar`); reativar
  não reconecta sozinho — a pessoa escaneia o QR de novo.
- Exclusão definitiva exige digitar o e-mail da conta pra confirmar (é irreversível: apaga WhatsApp,
  lançamentos e a conta) e só fica acessível para quem está logado como a conta DEV.
- Fora de escopo: trocar o código mestre de convite (`CONVITE`) pela tela — continua só no `.env`.

## 1. Esqueci a senha (self-service)

### Telas (`src/paginas.ts`)
- `paginaEntrar`: ganha o link "Esqueci minha senha" → `/esqueci-senha`, dentro do card, abaixo do botão Entrar.
- `paginaEsqueciSenha(enviado, email)`: modo formulário (campo e-mail) e modo confirmação (mensagem
  genérica: "Se esse e-mail existir na nossa base, enviamos um link de redefinição. Válido por 1 hora.").
- `paginaRedefinirSenha(token, erro)`: campo de nova senha (mínimo 8, mesmo padrão do cadastro) + token
  num `<input type="hidden">`.

### Rotas (`src/web.ts`)
- `GET /esqueci-senha`: se já logado, redireciona a `/painel`; senão mostra o formulário.
- `POST /esqueci-senha`: normaliza e-mail, checa `limitador` (chaves `f:<email>` e `i:<ip>`, mesma
  instância já usada por `/entrar`/`/cadastro`); registra a tentativa sempre (exista ou não a conta, pra
  não dar pista por rate limit); se a conta existir, gera o token e dispara o e-mail (ou loga o link no
  console, sem SMTP). Responde sempre com a mesma tela de confirmação.
- `GET /redefinir-senha?token=...`: mostra o formulário de nova senha com o token do query string.
- `POST /redefinir-senha`: valida tamanho da senha; consome o token; se válido, troca a senha (reaproveita
  `contas.redefinirSenha`, que já existe e já limpa os logins antigos), cria uma sessão nova e loga a
  pessoa direto no `/painel`. Token inválido/expirado → mensagem "Link inválido ou expirado. Solicite um
  novo." na mesma tela.

### Token e tabela (`src/contas.ts`)
Nova tabela, ao lado de `logins`:
```sql
CREATE TABLE IF NOT EXISTS redefinicoes_senha (
  id TEXT PRIMARY KEY,       -- SHA-256 do token (o token cru só existe no link do e-mail)
  conta_id TEXT NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL
);
```
- `criarRedefinicao(contaId)`: apaga tokens anteriores da conta, insere um novo (validade 1h), devolve o
  token cru.
- `consumirRedefinicao(token)`: `DELETE ... WHERE id = $1 AND expira_em > now() RETURNING conta_id`
  (atômico — uso único mesmo sob concorrência). Devolve `contaId | null`.
- `porEmail(email)`: busca de conta por e-mail (espelha `porId`), usada pra checar existência sem revelar
  nada ao chamador da rota.

### E-mail (`src/mailer.ts`, novo módulo)
```ts
export type OpcoesSmtp = { host: string; port: number; user: string; pass: string; from: string }
export type Mailer = { enviarRedefinicaoSenha(destino: string, link: string): Promise<void> }
export function criarMailer(op: OpcoesSmtp): Mailer
```
Usa `nodemailer.createTransport`, `secure: port === 465`. Assunto "WCOEN — redefinição de senha", corpo
texto + HTML simples com o link (válido por 1 hora). Falha de envio só loga no servidor — a resposta ao
cliente já foi enviada (genérica).

### Config (`src/config.ts`)
```ts
smtp?: { host: string; port: number; user: string; pass: string; from: string }
```
Opcional: presente só se `SMTP_HOST` estiver no `.env`. `SMTP_PORT` default 587, `SMTP_FROM` default
`SMTP_USER`.

## 2. Conta DEV

### Config
```ts
dev?: { email: string; senha: string }
```
Opcional: presente só se `DEV_EMAIL` e `DEV_PASSWORD` estiverem no `.env`. Sem essa variável, a conta DEV
não existe e a exclusão definitiva de contas fica indisponível (o botão nem aparece pra ninguém).

### Semeadura (`src/contas.ts`)
`semearDev(email, senha)`: `INSERT ... ON CONFLICT (email) DO UPDATE SET senha_hash = ...`. Chamado uma
vez no boot (`src/index.ts`), sempre que `config.dev` existir — assim, trocar `DEV_PASSWORD` no `.env` e
reiniciar já reseta a senha da conta (mesma ideia do SPECIUM: "esqueci minha senha de admin" vira só
trocar o `.env`).

### Reconhecimento (`src/web.ts`)
`isAdmin` passa a considerar também `email === op.devEmail`. Nenhuma coluna nova de papel: a conta DEV é
uma linha comum em `contas`, só reconhecida pelo e-mail bater com a config. Ela é filtrada da listagem de
contas do admin (não aparece na tela).

## 3. Administração de contas

### Tela (`src/paginas.ts`, dentro de `paginaAdmin`, novo card "Contas")
Lista: e-mail, status da conexão com o WhatsApp, ativa/desativada. Por linha:
- **Desativar** / **Reativar** (botão simples, qualquer admin).
- **Enviar link de redefinição** (botão simples, qualquer admin) — reaproveita `criarRedefinicao` + `mailer`.
- **Excluir definitivamente** — só renderizado quando quem está logado é a conta DEV. Um `<details>`
  (mesmo padrão já usado em "trocar grupo"/"usar código em vez do QR") escondendo um campo de texto
  "Digite o e-mail da conta para confirmar" + botão. O servidor recusa se o texto digitado não bater com
  o e-mail da conta.

### Rotas (`src/web.ts`, todas exigem `isAdmin(conta.email)`)
- `POST /admin/contas/desativar {id}`: `sessoes.desconectar(id)` (derruba o WhatsApp) + `contas.definirAtiva(id, false)`.
- `POST /admin/contas/reativar {id}`: `contas.definirAtiva(id, true)` (não reconecta o WhatsApp sozinho).
- `POST /admin/contas/redefinir {id}`: busca a conta por id, gera token, dispara e-mail (ou loga o link,
  sem SMTP).
- `POST /admin/contas/excluir {id, confirmarEmail}`: exige também `conta.email === op.devEmail` (403 pra
  qualquer outro admin); busca a conta por id, confere `confirmarEmail` contra o e-mail real (senão,
  volta pro admin com erro); então `sessoes.desconectar(id)` → `repo.apagarConta(id)` → `contas.excluirConta(id)`.

### Banco (`src/contas.ts`)
`ALTER TABLE contas ADD COLUMN IF NOT EXISTS ativa BOOLEAN NOT NULL DEFAULT true` (dentro do `CREATE
TABLE IF NOT EXISTS` existente, como uma instrução extra logo depois).
- `porId` passa a devolver `null` para conta com `ativa = false` — ponto único de checagem: toda leitura
  de sessão (`contaDe` em `web.ts`) já passa por `porId`, então desativar barra o acesso em qualquer rota
  de uma vez, sem espalhar o `if` por todo o código.
- `verificar` (login por e-mail+senha) ganha a mesma checagem de `ativa`, já que não passa por `porId`.
- `listarContas()`: nova consulta dedicada (não usa `porId`) — precisa enxergar contas inativas, pra dar
  pra reativar.
- `definirAtiva(contaId, ativa)`: `UPDATE contas SET ativa = $2 WHERE id = $1`; se `ativa = false`, apaga
  também os `logins` da conta (derruba sessão ativa na hora).
- `excluirConta(contaId)`: apaga `logins`, `redefinicoes_senha` e a linha de `contas` (nessa ordem).

### Banco (`src/repo.ts`)
`apagarConta(contaId)`: `DELETE FROM lancamentos WHERE conta_id = $1`. Exportado junto de `repoDe` no
retorno de `criarRepo`.

### Cascata da exclusão (orquestrada em `web.ts`, que já enxerga `contas`, `sessoes` e agora `repo`)
`sessoes.desconectar(id)` (desconecta o WhatsApp e apaga a credencial) → `repo.apagarConta(id)` (apaga o
histórico financeiro) → `contas.excluirConta(id)` (apaga login, redefinições e a conta). Sequencial,
melhor esforço — não é uma operação de altíssimo volume que justifique transação distribuída.

## Arquivos tocados
Novo: `src/mailer.ts`. Alterados: `src/config.ts`, `src/contas.ts`, `src/repo.ts`, `src/web.ts`,
`src/paginas.ts`, `src/index.ts`, `.env.example`, `package.json` (dependência `nodemailer`).

## Testes
Seguindo o padrão do repositório (`tests/*.test.ts`, Postgres real de teste):
- `contas.test.ts`: token de redefinição válido troca a senha e loga; token expirado/reusado falha;
  pedido novo invalida token anterior; `porId` ignora conta inativa; `definirAtiva(false)` derruba login
  ativo; `semearDev` cria/atualiza a senha da conta; `excluirConta` apaga logins e redefinições.
- `web.test.ts`: `/esqueci-senha` responde igual para e-mail existente e inexistente; rate limit não
  revela diferença; `/redefinir-senha` loga automaticamente após sucesso; rotas `/admin/contas/*` exigem
  admin; `/admin/contas/excluir` exige a conta DEV e o e-mail de confirmação corretos; conta inativa não
  consegue logar nem manter sessão.
- `mailer.ts`: transporte injetável (como `fetchFn` em `auditar.ts`) pra testar sem SMTP real.
