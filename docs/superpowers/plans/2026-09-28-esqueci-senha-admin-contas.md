# Esqueci a senha, conta DEV e administração de contas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar "Esqueci minha senha" (self-service por e-mail), uma conta DEV de recuperação/suporte, e uma tela de administração de contas (desativar/reativar, disparar redefinição, excluir definitivamente) ao portal do WCOEN.

**Architecture:** `nodemailer` via `src/mailer.ts` (config só por `.env`, degrada pro console sem SMTP configurado). Tokens de redefinição em uma tabela nova (`redefinicoes_senha`), espelhando o padrão já usado em `logins`. A conta DEV é uma linha comum de `contas`, reconhecida só por comparação de e-mail (`DEV_EMAIL`), sem coluna de papel nova. `contas.ts` ganha uma coluna `ativa`; `porId` (o único ponto de checagem de sessão) passa a ignorar conta inativa.

**Tech Stack:** Node/TypeScript, Postgres (`pg`), `nodemailer` (única dependência nova), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-28-esqueci-senha-admin-contas-design.md`

## Global Constraints

- Única dependência nova: `nodemailer`. Configuração de SMTP e da conta DEV só via `.env` (sem tela de admin dinâmica pra infra).
- Sem SMTP configurado, o link de redefinição é logado no console em vez de falhar.
- Resposta de `POST /esqueci-senha` é sempre a mesma mensagem genérica, exista ou não a conta.
- Token de redefinição: SHA-256 armazenado (o cru só existe no link do e-mail), validade 1 hora, uso único, um pedido novo invalida o anterior da mesma conta.
- Conta DEV: sem coluna de "papel"; reconhecida comparando o e-mail da sessão com `DEV_EMAIL` (mesmo padrão de `ADMIN_EMAILS`). Semeada/atualizada a cada boot a partir de `DEV_EMAIL`/`DEV_PASSWORD`.
- Desativar uma conta também desconecta o WhatsApp na hora (`sessoes.desconectar`) e derruba os logins ativos.
- Excluir definitivamente uma conta só é possível logado como a conta DEV, e exige digitar o e-mail da conta pra confirmar.

## Review Focus

- Depois do limite de pedidos de redefinição por e-mail/IP, o 6º pedido não pode disparar e-mail nem revelar o bloqueio (mesma mensagem genérica, 200).
- As rotas novas (`/esqueci-senha`, `/redefinir-senha`, `/admin/contas/*`) são POST e precisam continuar exigindo `Origin` do próprio site, como todas as outras.
- O e-mail digitado no formulário de "esqueci a senha" precisa sair escapado quando a tela volta a mostrá-lo.
- Um link de redefinição válido, mas cuja conta foi desativada nesse meio-tempo, precisa cair no aviso "link inválido/expirado" — nunca estourar erro 500.
- `/admin/contas/excluir` com um `id` forjado ou de conta que não existe mais precisa voltar pro admin sem erro, sem apagar nada.

---

## Task 1: Configuração — SMTP e conta DEV

**Files:**
- Modify: `src/config.ts`
- Modify: `tests/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `Config.smtp?: { host: string; port: number; user: string; pass: string; from: string }`, `Config.dev?: { email: string; senha: string }` — usados pelas tasks 2, 5 e 11.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/config.test.ts`, adicionar ao final do `describe('loadConfig', ...)`:

```ts
  it('SMTP é opcional: sem SMTP_HOST fica desligado', () => {
    expect(loadConfig(base).smtp).toBeUndefined()
  })

  it('lê SMTP com defaults de porta e remetente (SMTP_FROM cai pro SMTP_USER)', () => {
    const c = loadConfig({ ...base, SMTP_HOST: 'smtp.exemplo.com', SMTP_USER: 'bot@exemplo.com', SMTP_PASS: 'segredo' })
    expect(c.smtp).toEqual({ host: 'smtp.exemplo.com', port: 587, user: 'bot@exemplo.com', pass: 'segredo', from: 'bot@exemplo.com' })
  })

  it('SMTP_PORT e SMTP_FROM sobrescrevem os defaults', () => {
    const c = loadConfig({ ...base, SMTP_HOST: 'smtp.exemplo.com', SMTP_PORT: '465', SMTP_USER: 'bot@exemplo.com', SMTP_PASS: 'segredo', SMTP_FROM: 'no-reply@exemplo.com' })
    expect(c.smtp).toMatchObject({ port: 465, from: 'no-reply@exemplo.com' })
  })

  it('DEV é opcional: sem DEV_EMAIL/DEV_PASSWORD fica desligado', () => {
    expect(loadConfig(base).dev).toBeUndefined()
  })

  it('lê e normaliza DEV_EMAIL; exige os dois definidos juntos', () => {
    const c = loadConfig({ ...base, DEV_EMAIL: ' Dev@X.com ', DEV_PASSWORD: 'senha-dev-123' })
    expect(c.dev).toEqual({ email: 'dev@x.com', senha: 'senha-dev-123' })
    expect(() => loadConfig({ ...base, DEV_EMAIL: 'dev@x.com' })).toThrow('DEV_EMAIL e DEV_PASSWORD')
    expect(() => loadConfig({ ...base, DEV_PASSWORD: 'senha-dev-123' })).toThrow('DEV_EMAIL e DEV_PASSWORD')
  })
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- config.test.ts`
Expected: FAIL — `smtp`/`dev` não existem em `Config`.

- [ ] **Step 3: Implementar**

Em `src/config.ts`, adicionar ao `type Config`:

```ts
  smtp?: { host: string; port: number; user: string; pass: string; from: string } // opcional: sem SMTP_HOST, o link de redefinição só é logado no console
  dev?: { email: string; senha: string } // opcional: conta de recuperação/suporte, oculta da lista de contas do admin
```

Em `loadConfig`, antes do `return`, adicionar:

```ts
  let smtp: Config['smtp']
  if (env.SMTP_HOST) {
    const user = env.SMTP_USER ?? ''
    const pass = env.SMTP_PASS ?? ''
    smtp = { host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, user, pass, from: env.SMTP_FROM || user }
  }

  let dev: Config['dev']
  if (env.DEV_EMAIL || env.DEV_PASSWORD) {
    if (!env.DEV_EMAIL || !env.DEV_PASSWORD) throw new Error('DEV_EMAIL e DEV_PASSWORD precisam ser definidos juntos')
    dev = { email: env.DEV_EMAIL.trim().toLowerCase(), senha: env.DEV_PASSWORD }
  }
```

E acrescentar `smtp,` e `dev,` no objeto retornado (junto de `openrouter,`).

Em `.env.example`, acrescentar ao final:

```
# Opcional: e-mail de "esqueci a senha" (nodemailer, SMTP). Sem SMTP_HOST, o link só é logado no
# servidor em vez de enviado — útil em dev. SMTP_PORT default 587; SMTP_FROM default = SMTP_USER.
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Opcional: conta DEV de recuperação/suporte. Loga pela tela normal de /entrar; some da lista de
# contas do admin; só ela vê o botão de excluir uma conta definitivamente. Trocar DEV_PASSWORD e
# reiniciar já atualiza a senha dessa conta (não precisa lembrar a antiga).
DEV_EMAIL=
DEV_PASSWORD=
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts .env.example
git commit -m "feat: config opcional de SMTP e da conta DEV"
```

---

## Task 2: Módulo de e-mail (`src/mailer.ts`)

**Files:**
- Create: `src/mailer.ts`
- Create: `tests/mailer.test.ts`
- Modify: `package.json` (dependência `nodemailer`)

**Interfaces:**
- Consumes: `OpcoesSmtp` do formato de `Config['smtp']` (Task 1) — mesmos campos, tipo próprio pra não acoplar `mailer.ts` a `config.ts`.
- Produces: `criarMailer(op: OpcoesSmtp, criarTransporte?): Mailer`, `Mailer.enviarRedefinicaoSenha(destino: string, link: string): Promise<void>` — usado pelas tasks 9, 10 e 11.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install nodemailer`
Expected: `package.json` e `package-lock.json` ganham `nodemailer` em `dependencies` (o pacote já publica seus próprios tipos TS — sem `@types/nodemailer`).

- [ ] **Step 2: Escrever o teste que falha**

Criar `tests/mailer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { criarMailer } from '../src/mailer'

describe('criarMailer', () => {
  const op = { host: 'smtp.exemplo.com', port: 587, user: 'bot@exemplo.com', pass: 'segredo', from: 'no-reply@exemplo.com' }

  it('monta o transporte com host/porta/credenciais; porta 465 liga secure', () => {
    const criarTransporte = vi.fn(() => ({ sendMail: vi.fn() }))
    criarMailer(op, criarTransporte)
    expect(criarTransporte).toHaveBeenCalledWith({ host: 'smtp.exemplo.com', port: 587, secure: false, auth: { user: 'bot@exemplo.com', pass: 'segredo' } })

    criarMailer({ ...op, port: 465 }, criarTransporte)
    expect(criarTransporte).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true }))
  })

  it('enviarRedefinicaoSenha manda de/para, assunto e o link no texto e no html', async () => {
    const sendMail = vi.fn()
    const mailer = criarMailer(op, () => ({ sendMail }))
    await mailer.enviarRedefinicaoSenha('ana@x.com', 'https://app.exemplo.com/redefinir-senha?token=abc')
    expect(sendMail).toHaveBeenCalledTimes(1)
    const [msg] = sendMail.mock.calls[0]
    expect(msg.from).toBe('no-reply@exemplo.com')
    expect(msg.to).toBe('ana@x.com')
    expect(msg.subject).toContain('redefinição de senha')
    expect(msg.text).toContain('https://app.exemplo.com/redefinir-senha?token=abc')
    expect(msg.html).toContain('href="https://app.exemplo.com/redefinir-senha?token=abc"')
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm test -- mailer.test.ts`
Expected: FAIL — `src/mailer.ts` não existe.

- [ ] **Step 4: Implementar**

Criar `src/mailer.ts`:

```ts
import nodemailer from 'nodemailer'

export type OpcoesSmtp = { host: string; port: number; user: string; pass: string; from: string }
export type Transporte = { sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> }
type CriarTransporte = (opcoes: { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }) => Transporte
export type Mailer = { enviarRedefinicaoSenha(destino: string, link: string): Promise<void> }

const criarTransportePadrao: CriarTransporte = (opcoes) => nodemailer.createTransport(opcoes) as unknown as Transporte

export function criarMailer(op: OpcoesSmtp, criarTransporte: CriarTransporte = criarTransportePadrao): Mailer {
  const transporte = criarTransporte({ host: op.host, port: op.port, secure: op.port === 465, auth: { user: op.user, pass: op.pass } })
  return {
    async enviarRedefinicaoSenha(destino, link) {
      await transporte.sendMail({
        from: op.from,
        to: destino,
        subject: 'WCOEN — redefinição de senha',
        text: `Recebemos um pedido para redefinir sua senha.\n\nAbra o link (válido por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.`,
        html: `<p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${link}">Redefinir senha</a> (válido por 1 hora)</p><p>Se não foi você, ignore este e-mail.</p>`,
      })
    },
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm test -- mailer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/mailer.ts tests/mailer.test.ts package.json package-lock.json
git commit -m "feat: módulo de e-mail (nodemailer) para redefinição de senha"
```

---

## Task 3: `contas.ts` — coluna `ativa`, `listarContas`, `definirAtiva`

**Files:**
- Modify: `src/contas.ts`
- Modify: `tests/contas.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `ContaResumo` (tipo exportado), `contas.listarContas(): Promise<ContaResumo[]>`, `contas.definirAtiva(contaId: string, ativa: boolean): Promise<void>` — usados pelas tasks 8 e 10. `porId`/`verificar` passam a ignorar conta inativa — usado implicitamente por `web.ts` (`contaDe`) já existente.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/contas.test.ts`, acrescentar ao final do arquivo:

```ts
describe('admin: contas', () => {
  it('listarContas lista todas (inclusive inativas), da mais nova pra mais velha', async () => {
    const a = ((await cadastrar('a@x.com')) as { ok: true; conta: { id: string } }).conta
    const b = ((await cadastrar('b@x.com')) as { ok: true; conta: { id: string } }).conta
    await contas.definirAtiva(a.id, false)
    const lista = await contas.listarContas()
    expect(lista.map((c) => c.email)).toEqual(['b@x.com', 'a@x.com'])
    expect(lista.find((c) => c.id === a.id)?.ativa).toBe(false)
    expect(lista.find((c) => c.id === b.id)?.ativa).toBe(true)
  })

  // Review Focus do plano: porId é o único ponto de checagem de sessão — precisa barrar conta inativa sozinho.
  it('definirAtiva(false) derruba os logins ativos e bloqueia porId/verificar; reativar libera de novo', async () => {
    const { conta } = (await cadastrar('c@x.com')) as { ok: true; conta: { id: string } }
    const token = await contas.criarLogin(conta.id)
    await contas.definirAtiva(conta.id, false)
    expect(await contas.contaDoLogin(token)).toBeNull()
    expect(await contas.porId(conta.id)).toBeNull()
    expect(await contas.verificar('c@x.com', 'senha-boa-123')).toBeNull()
    await contas.definirAtiva(conta.id, true)
    expect(await contas.porId(conta.id)).not.toBeNull()
    expect(await contas.verificar('c@x.com', 'senha-boa-123')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- contas.test.ts`
Expected: FAIL — `listarContas`/`definirAtiva` não existem.

- [ ] **Step 3: Implementar**

Em `src/contas.ts`:

1. No `RowConta`, acrescentar `ativa: boolean`.
2. No SQL de `criarContas`, logo depois do `CREATE TABLE IF NOT EXISTS contas (...)`, acrescentar:

```ts
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS ativa BOOLEAN NOT NULL DEFAULT true;
```

3. Trocar `porId`:

```ts
  const porId = async (id: string): Promise<Conta | null> => {
    const r = await pool.query<RowConta>('SELECT * FROM contas WHERE id = $1', [id])
    const d = r.rows[0]
    return d && d.ativa ? paraConta(d) : null
  }
```

4. Trocar a linha de retorno de `verificar`:

```ts
      return d && ok && d.ativa ? paraConta(d) : null
```

5. Acrescentar, exportado, antes de `criarContas`:

```ts
export type ContaResumo = { id: string; email: string; criadaEm: Date; grupoNome?: string; conectada: boolean; ativa: boolean }
```

6. Acrescentar ao objeto retornado por `criarContas` (perto de `conectadas`):

```ts
    async listarContas(): Promise<ContaResumo[]> {
      const r = await pool.query<RowConta>('SELECT * FROM contas ORDER BY criada_em DESC')
      return r.rows.map((d) => ({ id: d.id, email: d.email, criadaEm: d.criada_em, grupoNome: d.grupo_nome ?? undefined, conectada: Boolean(d.conectada), ativa: d.ativa }))
    },

    async definirAtiva(contaId: string, ativa: boolean): Promise<void> {
      await pool.query('UPDATE contas SET ativa = $2 WHERE id = $1', [contaId, ativa])
      if (!ativa) await pool.query('DELETE FROM logins WHERE conta_id = $1', [contaId])
    },
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- contas.test.ts`
Expected: PASS (toda a suíte de `contas.test.ts`, não só o describe novo — `porId`/`verificar` mudaram).

- [ ] **Step 5: Commit**

```bash
git add src/contas.ts tests/contas.test.ts
git commit -m "feat: contas ganham ativa/inativa; listarContas e definirAtiva pro admin"
```

---

## Task 4: `contas.ts` — token de redefinição de senha (`redefinicoes_senha`)

**Files:**
- Modify: `src/contas.ts`
- Modify: `tests/contas.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (independente da Task 3, mas edita o mesmo arquivo).
- Produces: `contas.porEmail(email: string): Promise<Conta | null>`, `contas.criarRedefinicao(contaId: string): Promise<string>`, `contas.consumirRedefinicao(token: string): Promise<string | null>` — usados pelas tasks 9 e 10.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/contas.test.ts`, no `beforeEach`, acrescentar o drop da tabela nova:

```ts
beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS redefinicoes_senha')
  await pool.query('DROP TABLE IF EXISTS logins')
  await pool.query('DROP TABLE IF EXISTS contas')
  contas = await criarContas(pool, { convite: 'segredo' })
})
```

E acrescentar ao final do arquivo:

```ts
describe('redefinição de senha por e-mail', () => {
  it('token válido: consumirRedefinicao devolve o contaId; token some depois (uso único)', async () => {
    const { conta } = (await cadastrar('r1@x.com')) as { ok: true; conta: { id: string } }
    const token = await contas.criarRedefinicao(conta.id)
    expect(await contas.consumirRedefinicao(token)).toBe(conta.id)
    expect(await contas.consumirRedefinicao(token)).toBeNull()
  })

  it('token expirado é recusado', async () => {
    const { conta } = (await cadastrar('r2@x.com')) as { ok: true; conta: { id: string } }
    const token = await contas.criarRedefinicao(conta.id)
    await pool.query("UPDATE redefinicoes_senha SET expira_em = now() - interval '1 second' WHERE conta_id = $1", [conta.id])
    expect(await contas.consumirRedefinicao(token)).toBeNull()
  })

  it('pedido novo invalida o token anterior da mesma conta', async () => {
    const { conta } = (await cadastrar('r3@x.com')) as { ok: true; conta: { id: string } }
    const antigo = await contas.criarRedefinicao(conta.id)
    await contas.criarRedefinicao(conta.id)
    expect(await contas.consumirRedefinicao(antigo)).toBeNull()
  })

  it('token desconhecido dá null', async () => {
    expect(await contas.consumirRedefinicao('token-que-nunca-existiu')).toBeNull()
  })

  it('consumirRedefinicao em concorrência: exatamente um sucede', async () => {
    const { conta } = (await cadastrar('corrida-token@x.com')) as { ok: true; conta: { id: string } }
    const token = await contas.criarRedefinicao(conta.id)
    const [r1, r2] = await Promise.all([contas.consumirRedefinicao(token), contas.consumirRedefinicao(token)])
    expect([r1, r2].filter((r) => r !== null)).toEqual([conta.id])
  })

  it('porEmail acha a conta ativa; e-mail desconhecido ou conta inativa dá null', async () => {
    const { conta } = (await cadastrar('r4@x.com')) as { ok: true; conta: { id: string } }
    expect((await contas.porEmail('R4@X.com'))?.id).toBe(conta.id)
    expect(await contas.porEmail('ninguem@x.com')).toBeNull()
    await contas.definirAtiva(conta.id, false)
    expect(await contas.porEmail('r4@x.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- contas.test.ts`
Expected: FAIL — `porEmail`/`criarRedefinicao`/`consumirRedefinicao` não existem.

- [ ] **Step 3: Implementar**

Em `src/contas.ts`:

1. Acrescentar constante, perto de `TRINTA_DIAS_MS`:

```ts
const UMA_HORA_MS = 60 * 60_000
```

2. No SQL de `criarContas`, depois da criação de `logins`, acrescentar:

```ts
    CREATE TABLE IF NOT EXISTS redefinicoes_senha (
      id TEXT PRIMARY KEY,
      conta_id TEXT NOT NULL,
      expira_em TIMESTAMPTZ NOT NULL
    );
```

3. Acrescentar ao objeto retornado por `criarContas` (perto de `contaDoLogin`/`encerrarLogin`):

```ts
    async porEmail(email: string): Promise<Conta | null> {
      const r = await pool.query<RowConta>('SELECT * FROM contas WHERE email = $1', [normalizar(email)])
      const d = r.rows[0]
      return d && d.ativa ? paraConta(d) : null
    },

    async criarRedefinicao(contaId: string): Promise<string> {
      await pool.query('DELETE FROM redefinicoes_senha WHERE conta_id = $1', [contaId])
      const token = randomBytes(32).toString('base64url')
      await pool.query('INSERT INTO redefinicoes_senha (id, conta_id, expira_em) VALUES ($1,$2,$3)', [
        sha256(token).toString('hex'),
        contaId,
        new Date(Date.now() + UMA_HORA_MS),
      ])
      return token
    },

    async consumirRedefinicao(token: string): Promise<string | null> {
      const r = await pool.query<{ conta_id: string }>(
        'DELETE FROM redefinicoes_senha WHERE id = $1 AND expira_em > now() RETURNING conta_id',
        [sha256(token).toString('hex')],
      )
      return r.rows[0]?.conta_id ?? null
    },
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- contas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contas.ts tests/contas.test.ts
git commit -m "feat: token de redefinição de senha (uso único, validade 1h)"
```

---

## Task 5: `contas.ts` — conta DEV e exclusão definitiva

**Files:**
- Modify: `src/contas.ts`
- Modify: `tests/contas.test.ts`

**Interfaces:**
- Consumes: `contas.criarLogin`, `contas.criarRedefinicao` (Task 4), `contas.verificar` (já existente) — usados só nos testes deste task.
- Produces: `contas.semearDev(email: string, senha: string): Promise<void>`, `contas.excluirConta(contaId: string): Promise<void>` — usados pelas tasks 10 e 11.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/contas.test.ts`, acrescentar ao final:

```ts
describe('conta DEV e exclusão definitiva', () => {
  it('semearDev cria a conta na primeira vez e atualiza a senha nas próximas chamadas', async () => {
    await contas.semearDev('Dev@X.com', 'senha-dev-1')
    expect(await contas.verificar('dev@x.com', 'senha-dev-1')).not.toBeNull()
    await contas.semearDev('dev@x.com', 'senha-dev-2')
    expect(await contas.verificar('dev@x.com', 'senha-dev-1')).toBeNull()
    expect(await contas.verificar('dev@x.com', 'senha-dev-2')).not.toBeNull()
  })

  it('excluirConta apaga logins, redefinições pendentes e a conta', async () => {
    const { conta } = (await cadastrar('excluir@x.com')) as { ok: true; conta: { id: string } }
    const token = await contas.criarLogin(conta.id)
    await contas.criarRedefinicao(conta.id)
    await contas.excluirConta(conta.id)
    expect(await contas.contaDoLogin(token)).toBeNull()
    expect((await pool.query('SELECT 1 FROM redefinicoes_senha WHERE conta_id = $1', [conta.id])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM contas WHERE id = $1', [conta.id])).rowCount).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- contas.test.ts`
Expected: FAIL — `semearDev`/`excluirConta` não existem.

- [ ] **Step 3: Implementar**

Em `src/contas.ts`, acrescentar ao objeto retornado por `criarContas`:

```ts
    async semearDev(email: string, senha: string): Promise<void> {
      const e = normalizar(email)
      await pool.query(
        'INSERT INTO contas (id, email, senha_hash, criada_em) VALUES ($1,$2,$3,now()) ON CONFLICT (email) DO UPDATE SET senha_hash = $3',
        [randomUUID(), e, await hashSenha(senha)],
      )
    },

    async excluirConta(contaId: string): Promise<void> {
      await pool.query('DELETE FROM logins WHERE conta_id = $1', [contaId])
      await pool.query('DELETE FROM redefinicoes_senha WHERE conta_id = $1', [contaId])
      await pool.query('DELETE FROM contas WHERE id = $1', [contaId])
    },
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- contas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contas.ts tests/contas.test.ts
git commit -m "feat: conta DEV semeada por env e exclusão definitiva de conta"
```

---

## Task 6: `repo.ts` — `apagarConta`

**Files:**
- Modify: `src/repo.ts`
- Modify: `tests/pgRepo.test.ts`

**Interfaces:**
- Produces: `apagarConta(contaId: string): Promise<void>` no objeto retornado por `criarRepo` (junto de `repoDe`) — usado pela Task 10 (`web.ts`) e Task 11 (`index.ts`).

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/pgRepo.test.ts`, trocar o helper `abrir()` e os testes que o usam, pra devolver o objeto inteiro em vez de só `repoDe`:

```ts
async function abrir() {
  await limpador.query('DROP TABLE IF EXISTS lancamentos')
  const pool = new Pool({ connectionString: URL })
  const repo = await criarRepo(pool)
  fechar.push(() => pool.end())
  return repo
}

repoContract(
  'PgRepo',
  async () => (await abrir()).repoDe('conta-teste'),
  async () => {
    const { repoDe } = await abrir()
    return [repoDe('a'), repoDe('b')]
  },
)

it('add rejeita msgId repetido na mesma conta com "duplicado", sem estourar erro', async () => {
  const { repoDe } = await abrir()
  const repo = repoDe('c')
  const l = { tipo: 'despesa' as const, conta: 'x', valor: 100, remetente: 'u', msgId: 'm1', data: new Date(), enviadoEm: new Date() }
  expect(await repo.add(l)).toBe('ok')
  expect(await repo.add(l)).toBe('duplicado')
})

it('desfazerUltimo em concorrência: exatamente um sucede, outro retorna null', async () => {
  const { repoDe } = await abrir()
  const repo = repoDe('d')
  const l = { tipo: 'despesa' as const, conta: 'x', valor: 100, remetente: 'u', msgId: 'm2', data: new Date(), enviadoEm: new Date() }
  expect(await repo.add(l)).toBe('ok')
  const [r1, r2] = await Promise.all([repo.desfazerUltimo(), repo.desfazerUltimo()])
  const resultados = [r1, r2]
  expect(resultados.filter((x) => x !== null)).toHaveLength(1)
  expect(resultados.filter((x) => x === null)).toHaveLength(1)
})

it('apagarConta remove só os lançamentos daquela conta', async () => {
  const { repoDe, apagarConta } = await abrir()
  const l = (msgId: string) => ({ tipo: 'despesa' as const, conta: 'x', valor: 100, remetente: 'u', msgId, data: new Date(), enviadoEm: new Date() })
  await repoDe('a').add(l('m1'))
  await repoDe('b').add(l('m1'))
  await apagarConta('a')
  expect((await repoDe('a').balancete(null)).despesas).toEqual([])
  expect((await repoDe('b').balancete(null)).despesas).toEqual([{ conta: 'x', total: 100 }])
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- pgRepo.test.ts`
Expected: FAIL — `apagarConta` não existe no retorno de `criarRepo`.

- [ ] **Step 3: Implementar**

Em `src/repo.ts`, trocar o `return` de `criarRepo`:

```ts
  return {
    repoDe: (contaId: string) => new PgRepo(pool, contaId) as Repo,
    apagarConta: (contaId: string) => pool.query('DELETE FROM lancamentos WHERE conta_id = $1', [contaId]).then(() => undefined),
  }
```

E, logo acima, exportar o tipo do retorno (nome diferente do `Repo` de `src/types.ts`, que já é a interface por-conta):

```ts
export type Repositorio = Awaited<ReturnType<typeof criarRepo>>
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- pgRepo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repo.ts tests/pgRepo.test.ts
git commit -m "feat: apagarConta no repo (apaga o histórico de lançamentos)"
```

---

## Task 7: `paginas.ts` — telas de "esqueci a senha" e "redefinir senha"

**Files:**
- Modify: `src/paginas.ts`
- Modify: `tests/paginas.test.ts`

**Interfaces:**
- Produces: `paginaEsqueciSenha(enviado?: boolean, email?: string): string`, `paginaRedefinirSenha(token: string, erro?: string): string` — usados pela Task 9 (`web.ts`). `paginaEntrar` ganha o link pra `/esqueci-senha`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/paginas.test.ts`, acrescentar ao final:

```ts
describe('esqueci a senha / redefinir senha', () => {
  it('tela de entrar tem o link para /esqueci-senha', () => {
    expect(paginaEntrar()).toContain('href="/esqueci-senha"')
  })

  it('paginaEsqueciSenha: formulário por padrão, com e-mail preservado', () => {
    const html = paginaEsqueciSenha(false, 'ana@x.com')
    expect(html).toMatch(/<label[^>]*for="email"/)
    expect(html).toContain('value="ana@x.com"')
    expect(html).toContain('action="/esqueci-senha"')
  })

  it('e-mail com HTML no formulário sai escapado', () => {
    const html = paginaEsqueciSenha(false, '<b>@x.com')
    expect(html).toContain('value="&lt;b&gt;@x.com"')
    expect(html).not.toContain('value="<b>')
  })

  it('paginaEsqueciSenha(true): mensagem genérica, sem formulário', () => {
    const html = paginaEsqueciSenha(true)
    expect(html).toContain('Se esse e-mail existir na nossa base')
    expect(html).not.toContain('action="/esqueci-senha"')
  })

  it('paginaRedefinirSenha: token no campo oculto, senha mínima 8, erro escapado', () => {
    const html = paginaRedefinirSenha('tok<script>', 'Link inválido ou expirado.')
    expect(html).toContain('name="token" value="tok&lt;script&gt;"')
    expect(html).toContain('minlength="8"')
    expect(html).toMatch(/role="alert"[^>]*>[\s\S]*Link inválido ou expirado\./)
  })
})
```

E atualizar o import no topo do arquivo pra incluir `paginaEsqueciSenha, paginaRedefinirSenha`.

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- paginas.test.ts`
Expected: FAIL — funções não existem; link não existe em `paginaEntrar`.

- [ ] **Step 3: Implementar**

Em `src/paginas.ts`, trocar `paginaEntrar`:

```ts
export const paginaEntrar = (erro?: string, email = '') =>
  telaAuth(
    'Entrar',
    `<section class="cartao"><h2>Entrar</h2><p class="sub">Acesse seu painel.</p>${aviso(erro)}<form method="post" action="/entrar">${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: email, extra: 'autocomplete="username"' })}${campo({ nome: 'senha', rotulo: 'Senha', tipo: 'password', extra: 'autocomplete="current-password"' })}<button class="btn">Entrar</button></form><p class="rodape-form"><a href="/esqueci-senha">Esqueci minha senha</a></p></section><p class="rodape-form">Ainda não tem conta? <a href="/cadastro">Cadastre-se</a></p>`,
  )
```

E acrescentar, logo depois de `paginaEntrar`:

```ts
export const paginaEsqueciSenha = (enviado = false, email = '') =>
  telaAuth(
    'Esqueci minha senha',
    enviado
      ? `<section class="cartao"><h2>Verifique seu e-mail</h2><p class="sub">Se esse e-mail existir na nossa base, enviamos um link para redefinir a senha. O link vale por 1 hora.</p></section><p class="rodape-form"><a href="/entrar">Voltar para Entrar</a></p>`
      : `<section class="cartao"><h2>Esqueci minha senha</h2><p class="sub">Informe seu e-mail para receber um link de redefinição.</p><form method="post" action="/esqueci-senha">${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: email, extra: 'autocomplete="username"' })}<button class="btn">Enviar link</button></form></section><p class="rodape-form"><a href="/entrar">Voltar para Entrar</a></p>`,
  )

export const paginaRedefinirSenha = (token: string, erro?: string) =>
  telaAuth(
    'Redefinir senha',
    `<section class="cartao"><h2>Redefinir senha</h2><p class="sub">Escolha uma nova senha para sua conta.</p>${aviso(erro)}<form method="post" action="/redefinir-senha"><input type="hidden" name="token" value="${esc(token)}">${campo({ nome: 'senha', rotulo: 'Nova senha (mínimo 8 caracteres)', tipo: 'password', extra: 'minlength="8" autocomplete="new-password"' })}<button class="btn">Redefinir senha</button></form></section>`,
  )
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- paginas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: telas de esqueci a senha e redefinir senha"
```

---

## Task 8: `paginas.ts` — card "Contas" na administração

**Files:**
- Modify: `src/paginas.ts`
- Modify: `tests/paginas.test.ts`

**Interfaces:**
- Consumes: `ContaResumo` (Task 3, `src/contas.ts`).
- Produces: `paginaAdmin(email: string, convites: Convite[], contasAdmin?: ContaResumo[], souDev?: boolean): string` (assinatura estendida, com defaults pra não quebrar chamadas existentes) — usado pela Task 10 (`web.ts`).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/paginas.test.ts`, acrescentar ao final e importar `type { ContaResumo } from '../src/contas'` no topo:

```ts
describe('admin: contas', () => {
  const contaAtiva: ContaResumo = { id: 'c1', email: 'ana@x.com', criadaEm: new Date('2026-09-10T12:00:00Z'), conectada: true, grupoNome: 'Casa', ativa: true }
  const contaInativa: ContaResumo = { id: 'c2', email: 'bob@x.com', criadaEm: new Date('2026-09-11T12:00:00Z'), conectada: false, ativa: false }

  it('lista as contas com e-mail e ação de alternar status', () => {
    const html = paginaAdmin('admin@x.com', [], [contaAtiva, contaInativa], false)
    expect(html).toContain('ana@x.com')
    expect(html).toMatch(/action="\/admin\/contas\/desativar"[\s\S]*?value="c1"/)
    expect(html).toMatch(/action="\/admin\/contas\/reativar"[\s\S]*?value="c2"/)
  })

  it('"Enviar link de redefinição" só aparece para conta ativa', () => {
    const html = paginaAdmin('admin@x.com', [], [contaAtiva, contaInativa], false)
    expect(html).toMatch(/value="c1"[\s\S]{0,300}Enviar link de redefinição/)
    expect(html).not.toMatch(/value="c2"[\s\S]{0,300}Enviar link de redefinição/)
  })

  it('"Excluir definitivamente" só aparece quando souDev é true', () => {
    const semDev = paginaAdmin('admin@x.com', [], [contaAtiva], false)
    const comDev = paginaAdmin('dev@x.com', [], [contaAtiva], true)
    expect(semDev).not.toContain('Excluir definitivamente')
    expect(comDev).toContain('Excluir definitivamente')
    expect(comDev).toContain('Digite ana@x.com para confirmar')
  })

  it('sem contas: mensagem de lista vazia', () => {
    expect(paginaAdmin('admin@x.com', [], [], false)).toContain('Nenhuma conta cadastrada ainda.')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- paginas.test.ts`
Expected: FAIL — `paginaAdmin` ainda não recebe contas.

- [ ] **Step 3: Implementar**

Em `src/paginas.ts`, importar o tipo novo no topo:

```ts
import type { Conta, ContaResumo } from './contas'
```

Acrescentar, antes de `paginaAdmin` (perto de `itemConvite`):

```ts
const dataHoraCurta = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d)

const itemConta = (c: ContaResumo, souDev: boolean) => {
  const status = c.ativa ? '<span class="chip chip-ok">Ativa</span>' : '<span class="chip">Desativada</span>'
  const conexao = c.conectada ? `<span class="sub">· conectada${c.grupoNome ? ` (${esc(c.grupoNome)})` : ''}</span>` : ''
  const alternar = `<form method="post" action="/admin/contas/${c.ativa ? 'desativar' : 'reativar'}"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sec pequeno">${c.ativa ? 'Desativar' : 'Reativar'}</button></form>`
  const redefinir = c.ativa
    ? `<form method="post" action="/admin/contas/redefinir"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sec pequeno">Enviar link de redefinição</button></form>`
    : ''
  const excluir = souDev
    ? `<details><summary>Excluir definitivamente</summary><form method="post" action="/admin/contas/excluir"><input type="hidden" name="id" value="${esc(c.id)}"><div class="campo"><label for="confirmar-${esc(c.id)}">Digite ${esc(c.email)} para confirmar</label><input id="confirmar-${esc(c.id)}" name="confirmarEmail" type="text" required autocomplete="off"></div><button class="btn sec pequeno">Excluir definitivamente</button></form></details>`
    : ''
  return `<li class="convite"><div><code>${esc(c.email)}</code> <span class="sub">· ${dataHoraCurta(c.criadaEm)}</span>${conexao}</div>${status}${alternar}${redefinir}${excluir}</li>`
}
```

Trocar `paginaAdmin`:

```ts
export const paginaAdmin = (email: string, convites: Convite[], contasAdmin: ContaResumo[] = [], souDev = false) =>
  layout(
    'Administração',
    `<div class="pagina"><header class="topo">${marca('/painel')}<div class="usuario"><span class="email" title="${esc(email)}">${esc(email)}</span><form method="post" action="/sair"><button class="btn sec pequeno">${ic('sair')}Sair</button></form></div></header><main id="conteudo"><div class="cartao"><h2>Novo convite</h2><p class="sub">Gera um código de uso único para um cadastro.</p><form method="post" action="/admin/convites"><div class="campo"><label for="nota">Nota (opcional)</label><input id="nota" name="nota" type="text" maxlength="80" placeholder="Ex.: para o João"></div><button class="btn">Gerar convite</button></form></div><div class="cartao"><h2>Convites</h2>${convites.length ? `<ul class="convites">${convites.map(itemConvite).join('')}</ul>` : '<p class="sub">Nenhum convite ainda.</p>'}</div><div class="cartao"><h2>Contas</h2>${contasAdmin.length ? `<ul class="convites">${contasAdmin.map((c) => itemConta(c, souDev)).join('')}</ul>` : '<p class="sub">Nenhuma conta cadastrada ainda.</p>'}</div></main></div>`,
  )
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- paginas.test.ts`
Expected: PASS (inclusive os testes antigos de `página de administração (convites)`, que chamam `paginaAdmin` com só 2 argumentos — cobertos pelos defaults).

- [ ] **Step 5: Commit**

```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: card de contas na tela de administração"
```

---

## Task 9: `web.ts` — rotas `/esqueci-senha` e `/redefinir-senha`

**Files:**
- Modify: `src/web.ts`
- Modify: `tests/web.test.ts`

**Interfaces:**
- Consumes: `contas.porEmail`, `contas.criarRedefinicao`, `contas.consumirRedefinicao`, `contas.porId` (Task 4), `Mailer`/`Mailer.enviarRedefinicaoSenha` (Task 2), `paginaEsqueciSenha`, `paginaRedefinirSenha` (Task 7).
- Produces: `OpcoesWeb.mailer?: Mailer` — também consumido pela Task 10.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/web.test.ts`:

1. Importar `type { Mailer } from '../src/mailer'` no topo.
2. Acrescentar, perto de `sessoesFalsas`:

```ts
function mailerFalso() {
  return { enviarRedefinicaoSenha: vi.fn(async (_destino: string, _link: string) => {}) }
}
```

3. Declarar `let mailer: ReturnType<typeof mailerFalso>` junto das outras variáveis de módulo, e no `beforeAll`, antes de criar o `server`:

```ts
  mailer = mailerFalso()
```

e passar `mailer` pra `criarWeb(...)` (`criarWeb({ contas, sessoes: ..., convites, mailer, adminEmails: [EMAIL_ADMIN], ... })`).

4. Acrescentar ao final do arquivo:

```ts
describe('esqueci a senha', () => {
  it('GET /esqueci-senha mostra o formulário; logado redireciona pro painel', async () => {
    expect((await get('/esqueci-senha')).status).toBe(200)
    const { cookie } = await entrar()
    expect((await get('/esqueci-senha', cookie)).headers.get('location')).toBe('/painel')
  })

  it('POST sem Origin é recusado também nas rotas novas (403)', async () => {
    const semOrigem = await fetch(base + '/esqueci-senha', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ email: 'x@x.com' }) })
    expect(semOrigem.status).toBe(403)
  })

  it('e-mail existente manda o e-mail com o link; e-mail inexistente mostra a mesma mensagem genérica sem mandar nada', async () => {
    await entrar('esqueci1@x.com')
    const r1 = await post('/esqueci-senha', { email: 'esqueci1@x.com' })
    expect(r1.status).toBe(200)
    const texto1 = await r1.text()
    expect(texto1).toContain('Se esse e-mail existir na nossa base')
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledTimes(1)
    const [destino, link] = mailer.enviarRedefinicaoSenha.mock.calls[0]
    expect(destino).toBe('esqueci1@x.com')
    expect(link).toContain('/redefinir-senha?token=')

    const r2 = await post('/esqueci-senha', { email: 'nao-existe@x.com' })
    expect(await r2.text()).toBe(texto1)
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledTimes(1)
  })

  it('link do e-mail redefine a senha e já loga a pessoa', async () => {
    await entrar('esqueci2@x.com')
    await post('/esqueci-senha', { email: 'esqueci2@x.com' })
    const [, link] = mailer.enviarRedefinicaoSenha.mock.calls.at(-1)!
    const token = new URL(link).searchParams.get('token')!
    const r = await post('/redefinir-senha', { token, senha: 'senha-nova-123' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/painel')
    expect(r.headers.getSetCookie()[0]).toMatch(/^sid=/)
    expect((await post('/entrar', { email: 'esqueci2@x.com', senha: 'senha-nova-123' })).status).toBe(303)
  })

  it('token inválido/expirado dá 400 com aviso; senha curta também', async () => {
    const semToken = await post('/redefinir-senha', { token: 'nunca-existiu', senha: 'senha-boa-123' })
    expect(semToken.status).toBe(400)
    expect(await semToken.text()).toContain('Link inválido ou expirado')

    const curta = await post('/redefinir-senha', { token: 'qualquer', senha: '123' })
    expect(curta.status).toBe(400)
    expect(await curta.text()).toContain('ao menos 8 caracteres')
  })

  it('token de redefinição é uso único', async () => {
    await entrar('esqueci3@x.com')
    await post('/esqueci-senha', { email: 'esqueci3@x.com' })
    const [, link] = mailer.enviarRedefinicaoSenha.mock.calls.at(-1)!
    const token = new URL(link).searchParams.get('token')!
    await post('/redefinir-senha', { token, senha: 'senha-nova-123' })
    const segunda = await post('/redefinir-senha', { token, senha: 'outra-senha-123' })
    expect(segunda.status).toBe(400)
  })

  // Review Focus do plano: token válido, mas a conta foi desativada nesse meio-tempo — não pode quebrar.
  it('token válido mas conta foi desativada nesse meio-tempo: mostra link inválido, sem quebrar', async () => {
    const { conta } = await entrar('desativada-no-meio@x.com')
    await post('/esqueci-senha', { email: 'desativada-no-meio@x.com' })
    const [, link] = mailer.enviarRedefinicaoSenha.mock.calls.at(-1)!
    const token = new URL(link).searchParams.get('token')!
    await contas.definirAtiva(conta.id, false)
    const r = await post('/redefinir-senha', { token, senha: 'senha-nova-123' })
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('Link inválido ou expirado')
  })

  // Review Focus do plano: depois do limite, não pode mandar mais e-mail nem revelar o bloqueio.
  it('depois de 5 pedidos, o 6º não dispara e-mail mas responde igual (não revela o bloqueio)', async () => {
    const mesmoIp = { 'X-Forwarded-For': '203.0.113.50' }
    await entrar('limite@x.com')
    for (let i = 0; i < 5; i++) await post('/esqueci-senha', { email: 'limite@x.com' }, mesmoIp)
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledTimes(5)
    const r = await post('/esqueci-senha', { email: 'limite@x.com' }, mesmoIp)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('Se esse e-mail existir na nossa base')
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledTimes(5)
  })

  it('sem mailer configurado, ainda funciona: loga o link no console em vez de falhar', async () => {
    const semMailer = criarWeb({ contas, sessoes: sessoes as unknown as Sessoes, convites, adminEmails: [EMAIL_ADMIN], limitador: criarLimitador(5, 60_000), cookieSeguro: true, confiarProxy: true })
    await new Promise<void>((r) => semMailer.listen(0, '127.0.0.1', r))
    const baseSemMailer = `http://127.0.0.1:${(semMailer.address() as AddressInfo).port}`
    const postSemMailer = (caminho: string, dados: Record<string, string>) =>
      fetch(baseSemMailer + caminho, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseSemMailer }, body: form(dados) })
    await postSemMailer('/cadastro', { email: 'semmailer@x.com', senha: 'senha-boa-123', convite: 'segredo' })

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await postSemMailer('/esqueci-senha', { email: 'semmailer@x.com' })
    expect(r.status).toBe(200)
    expect(log.mock.calls.flat().join(' ')).toContain('/redefinir-senha?token=')
    log.mockRestore()

    semMailer.closeAllConnections()
    await new Promise((r) => semMailer.close(r))
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- web.test.ts`
Expected: FAIL — rotas ainda não existem.

- [ ] **Step 3: Implementar**

Em `src/web.ts`:

1. Imports: acrescentar `paginaEsqueciSenha, paginaRedefinirSenha` ao import de `./paginas`, e `import type { Mailer } from './mailer'`.
2. `OpcoesWeb`: acrescentar `mailer?: Mailer`.
3. Dentro de `criarWeb`, perto de `cookieSessao`/`tokenDe`, acrescentar:

```ts
  const baseUrl = (req: IncomingMessage) => `${op.cookieSeguro ? 'https' : 'http'}://${req.headers.host}`
```

4. No bloco `if (metodo === 'GET') { ... }`, logo depois do `if (caminho === '/entrar' || caminho === '/cadastro') { ... }`, acrescentar:

```ts
      if (caminho === '/esqueci-senha') {
        if (conta) return ir(res, '/painel')
        return html(res, 200, paginaEsqueciSenha())
      }
      if (caminho === '/redefinir-senha') {
        return html(res, 200, paginaRedefinirSenha(url.searchParams.get('token') ?? ''))
      }
```

5. No bloco POST, logo depois do `if (caminho === '/cadastro') { ... }` e antes de `if (caminho === '/sair') { ... }`, acrescentar:

```ts
    if (caminho === '/esqueci-senha') {
      const email = (f.get('email') ?? '').trim().toLowerCase()
      const chaves = [`f:${email}`, `i:${ipDe(req)}`]
      if (!chaves.some((k) => limitador.bloqueado(k))) {
        chaves.forEach((k) => limitador.falhou(k))
        const c = await contas.porEmail(email)
        if (c) {
          const token = await contas.criarRedefinicao(c.id)
          const link = `${baseUrl(req)}/redefinir-senha?token=${token}`
          if (op.mailer) op.mailer.enviarRedefinicaoSenha(c.email, link).catch((err) => console.error('mailer:', err instanceof Error ? err.message : err))
          else console.log(`[mailer] SMTP não configurado. Link de redefinição para ${c.email}: ${link}`)
        }
      }
      return html(res, 200, paginaEsqueciSenha(true))
    }

    if (caminho === '/redefinir-senha') {
      const token = f.get('token') ?? ''
      const senha = f.get('senha') ?? ''
      if (senha.length < 8) return html(res, 400, paginaRedefinirSenha(token, 'A senha precisa ter ao menos 8 caracteres.'))
      const contaId = await contas.consumirRedefinicao(token)
      const c = contaId ? await contas.porId(contaId) : null
      if (!c) return html(res, 400, paginaRedefinirSenha(token, 'Link inválido ou expirado. Solicite um novo link.'))
      await contas.redefinirSenha(c.email, senha)
      return ir(res, '/painel', cookieSessao(await contas.criarLogin(contaId!), TRINTA_DIAS_S))
    }
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- web.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web.ts tests/web.test.ts
git commit -m "feat: rotas de esqueci a senha e redefinir senha"
```

---

## Task 10: `web.ts` — administração de contas (`/admin/contas/*`) e conta DEV

**Files:**
- Modify: `src/web.ts`
- Modify: `tests/web.test.ts`

**Interfaces:**
- Consumes: `contas.listarContas`, `contas.definirAtiva`, `contas.porId` (Task 3), `contas.criarRedefinicao` (Task 4), `contas.excluirConta` (Task 5), `Repositorio`/`apagarConta` (Task 6), `paginaAdmin` estendida (Task 8), `sessoes.desconectar` (já existente).
- Produces: `OpcoesWeb.devEmail?: string`, `OpcoesWeb.repo: Repositorio` (obrigatório) — usados pela Task 11 (`index.ts`).

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/web.test.ts`:

1. Importar `type { Repositorio } from '../src/repo'` no topo.
2. Declarar, junto das outras variáveis de módulo: `const EMAIL_DEV = 'dev@x.com'` e `let repoFalso: { repoDe: ReturnType<typeof vi.fn>; apagarConta: ReturnType<typeof vi.fn> }`.
3. **Atenção:** este task torna `OpcoesWeb.repo` obrigatório (Step 3 abaixo). O teste "sem mailer configurado" da Task 9 (describe `esqueci a senha`) cria um segundo servidor com `criarWeb({...})` sem passar `repo` — depois deste task isso não compila mais. Nesse teste, acrescentar `repo: repoFalso as unknown as Repositorio` na chamada de `criarWeb({...})` desse segundo servidor também.
4. No `beforeAll`, antes de criar o `server`:

```ts
  await pool.query('DROP TABLE IF EXISTS redefinicoes_senha')
```

(acrescentar essa linha junto dos outros `DROP TABLE` já existentes), e logo depois de criar `contas`:

```ts
  await contas.semearDev(EMAIL_DEV, 'senha-dev-123')
  repoFalso = { repoDe: vi.fn(), apagarConta: vi.fn(async (_id: string) => {}) }
```

E atualizar a chamada de `criarWeb(...)` pra incluir `repo: repoFalso as unknown as Repositorio, devEmail: EMAIL_DEV`.

5. Acrescentar, perto de `entrar`:

```ts
async function entrarComo(email: string, senha: string) {
  const r = await post('/entrar', { email, senha })
  expect(r.status).toBe(303)
  return r.headers.getSetCookie()[0].split(';')[0]
}
```

5. Acrescentar ao final do arquivo:

```ts
describe('admin: contas', () => {
  let cookieDev: string
  beforeAll(async () => {
    cookieDev = await entrarComo(EMAIL_DEV, 'senha-dev-123')
  })

  it('conta DEV é admin e some da lista de contas do admin comum', async () => {
    const htmlAdmin = await (await get('/admin', cookieAdmin)).text()
    expect(htmlAdmin).not.toContain(EMAIL_DEV)
    expect((await get('/admin', cookieDev)).status).toBe(200)
  })

  it('lista a conta na tela; desativar bloqueia login e desconecta o WhatsApp; reativar libera de novo', async () => {
    const { conta } = await entrar('contaadmin1@x.com')
    const html1 = await (await get('/admin', cookieAdmin)).text()
    expect(html1).toContain('contaadmin1@x.com')

    const desativar = await post('/admin/contas/desativar', { id: conta.id }, { cookie: cookieAdmin })
    expect(desativar.headers.get('location')).toBe('/admin')
    expect(sessoes.desconectar).toHaveBeenCalledWith(conta.id)
    expect((await post('/entrar', { email: 'contaadmin1@x.com', senha: 'senha-boa-123' })).status).toBe(401)

    await post('/admin/contas/reativar', { id: conta.id }, { cookie: cookieAdmin })
    expect((await post('/entrar', { email: 'contaadmin1@x.com', senha: 'senha-boa-123' })).status).toBe(303)
  })

  it('"enviar link de redefinição" dispara o e-mail pra conta certa', async () => {
    const { conta } = await entrar('contaadmin2@x.com')
    const r = await post('/admin/contas/redefinir', { id: conta.id }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin')
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledWith('contaadmin2@x.com', expect.stringContaining('/redefinir-senha?token='))
  })

  it('rotas de contas exigem admin (403 pra quem não é)', async () => {
    const { cookie } = await entrar('naoadmin@x.com')
    expect((await post('/admin/contas/desativar', { id: 'x' }, { cookie })).status).toBe(403)
    expect((await post('/admin/contas/reativar', { id: 'x' }, { cookie })).status).toBe(403)
    expect((await post('/admin/contas/redefinir', { id: 'x' }, { cookie })).status).toBe(403)
    expect((await post('/admin/contas/excluir', { id: 'x', confirmarEmail: 'x' }, { cookie })).status).toBe(403)
  })

  it('excluir exige ser a conta DEV: admin comum toma 403 mesmo sendo admin', async () => {
    const { conta } = await entrar('naoexcluivel@x.com')
    const r = await post('/admin/contas/excluir', { id: conta.id, confirmarEmail: 'naoexcluivel@x.com' }, { cookie: cookieAdmin })
    expect(r.status).toBe(403)
    expect(await contas.porId(conta.id)).not.toBeNull()
  })

  it('excluir com e-mail de confirmação errado não apaga nada; certo apaga tudo (WhatsApp, lançamentos, conta)', async () => {
    const { conta } = await entrar('excluivel@x.com')
    const errado = await post('/admin/contas/excluir', { id: conta.id, confirmarEmail: 'errado@x.com' }, { cookie: cookieDev })
    expect(errado.headers.get('location')).toBe('/admin')
    expect(await contas.porId(conta.id)).not.toBeNull()
    expect(repoFalso.apagarConta).not.toHaveBeenCalled()

    const certo = await post('/admin/contas/excluir', { id: conta.id, confirmarEmail: 'excluivel@x.com' }, { cookie: cookieDev })
    expect(certo.headers.get('location')).toBe('/admin')
    expect(sessoes.desconectar).toHaveBeenCalledWith(conta.id)
    expect(repoFalso.apagarConta).toHaveBeenCalledWith(conta.id)
    expect((await pool.query('SELECT 1 FROM contas WHERE id = $1', [conta.id])).rowCount).toBe(0)
  })

  // Review Focus do plano: id forjado/inexistente não pode quebrar nem apagar nada.
  it('excluir com id inexistente não quebra e não apaga nada', async () => {
    const r = await post('/admin/contas/excluir', { id: 'nunca-existiu', confirmarEmail: 'qualquer@x.com' }, { cookie: cookieDev })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/admin')
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npm test -- web.test.ts`
Expected: FAIL — rotas e `semearDev`/`devEmail`/`repo` ainda não estão ligados em `web.ts`.

- [ ] **Step 3: Implementar**

Em `src/web.ts`:

1. Import: `import type { Repositorio } from './repo'`.
2. `OpcoesWeb`: acrescentar `devEmail?: string` e `repo: Repositorio` (obrigatório).
3. Trocar `isAdmin`:

```ts
  const isAdmin = (email: string) => (op.adminEmails ?? []).includes(email) || email === op.devEmail
```

4. Trocar o handler `GET /admin`:

```ts
      if (caminho === '/admin') {
        if (!conta) return ir(res, '/entrar')
        if (!isAdmin(conta.email)) throw new HttpErro(403)
        const contasAdmin = (await contas.listarContas()).filter((c) => c.email !== op.devEmail)
        return html(res, 200, paginaAdmin(conta.email, await convites.listar(), contasAdmin, conta.email === op.devEmail))
      }
```

5. No bloco POST autenticado (depois de `if (!conta) return ir(res, '/entrar')`), logo depois das rotas `/admin/convites*`, acrescentar:

```ts
    if (caminho === '/admin/contas/desativar') {
      if (!isAdmin(conta.email)) throw new HttpErro(403)
      const id = f.get('id') ?? ''
      await sessoes.desconectar(id)
      await contas.definirAtiva(id, false)
      return ir(res, '/admin')
    }
    if (caminho === '/admin/contas/reativar') {
      if (!isAdmin(conta.email)) throw new HttpErro(403)
      await contas.definirAtiva(f.get('id') ?? '', true)
      return ir(res, '/admin')
    }
    if (caminho === '/admin/contas/redefinir') {
      if (!isAdmin(conta.email)) throw new HttpErro(403)
      const alvo = await contas.porId(f.get('id') ?? '')
      if (alvo) {
        const token = await contas.criarRedefinicao(alvo.id)
        const link = `${baseUrl(req)}/redefinir-senha?token=${token}`
        if (op.mailer) op.mailer.enviarRedefinicaoSenha(alvo.email, link).catch((err) => console.error('mailer:', err instanceof Error ? err.message : err))
        else console.log(`[mailer] SMTP não configurado. Link de redefinição para ${alvo.email}: ${link}`)
      }
      return ir(res, '/admin')
    }
    if (caminho === '/admin/contas/excluir') {
      if (!isAdmin(conta.email)) throw new HttpErro(403)
      if (conta.email !== op.devEmail) throw new HttpErro(403)
      const id = f.get('id') ?? ''
      const alvo = (await contas.listarContas()).find((c) => c.id === id)
      if (alvo && (f.get('confirmarEmail') ?? '').trim().toLowerCase() === alvo.email) {
        await sessoes.desconectar(id)
        await op.repo.apagarConta(id)
        await contas.excluirConta(id)
      }
      return ir(res, '/admin')
    }
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npm test -- web.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web.ts tests/web.test.ts
git commit -m "feat: administração de contas (desativar/reativar/redefinir/excluir) e conta DEV"
```

---

## Task 11: `index.ts` — ligar tudo e checagem final

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `criarMailer` (Task 2), `contas.semearDev` (Task 5), `repo.apagarConta`/`Repositorio` (Task 6), `OpcoesWeb.mailer`/`devEmail`/`repo` (Tasks 9 e 10).
- Produces: nada (composition root — sem teste próprio, como já é hoje o padrão do arquivo).

- [ ] **Step 1: Implementar a fiação**

Em `src/index.ts`:

1. Import: `import { criarMailer } from './mailer'`.
2. Depois de `const repo = await criarRepo(banco.pool)`, acrescentar:

```ts
const mailer = config.smtp ? criarMailer(config.smtp) : undefined
if (config.dev) await contas.semearDev(config.dev.email, config.dev.senha)
```

3. Na chamada de `criarWeb({...})`, acrescentar `repo,`, `mailer,` e `devEmail: config.dev?.email,`:

```ts
const web = criarWeb({
  contas,
  sessoes,
  convites,
  repo,
  mailer,
  adminEmails: config.adminEmails,
  devEmail: config.dev?.email,
  limitador: criarLimitador(5, 15 * 60_000),
  cookieSeguro: Boolean(config.dominio),
  confiarProxy: Boolean(config.dominio),
})
```

- [ ] **Step 2: Checagem final**

Run: `npm run typecheck`
Expected: sem erros (confirma que `OpcoesWeb.repo` obrigatório está satisfeito e todos os tipos batem).

Run: `npm test`
Expected: toda a suíte passa (todas as tasks anteriores, mais a fiação nova exercida indiretamente pelos testes de `web.test.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: liga mailer, conta DEV e repo às rotas de contas"
```
