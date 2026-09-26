# Portal SaaS (sessões por cliente, QR web) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o bot de um número/grupo único em um serviço hospedado: o cliente se cadastra num portal web, conecta o próprio WhatsApp (QR ao vivo ou código de pareamento), escolhe o grupo e usa os comandos atuais, com dados isolados por conta.

**Architecture:** Monólito Node. `src/sessoes.ts` mantém uma conexão do Baileys por conta (fábrica de sockets injetável); `src/authstate.ts` guarda as credenciais criptografadas no Mongo; `src/contas.ts` cuida de cadastro/login; `src/web.ts` + `src/paginas.ts` servem o portal (HTTP nativo, HTML renderizado no servidor, QR por SSE). `Service`, `parser`, `period`, `money` e os cálculos **não mudam**; `Repo` ganha só uma fábrica por conta (`repoDe(contaId)`).

**Tech Stack:** Node ≥ 20.6 + TypeScript (ESM, `moduleResolution: Bundler`), Vitest, MongoDB 7 (Docker), Baileys `7.0.0-rc14`, `node:http`, `node:crypto`; **única dependência nova:** `qrcode` (+ `@types/qrcode`).

**Spec:** `docs/superpowers/specs/2026-09-26-portal-saas-design.md`

## Global Constraints

- Sem novo framework web nem de front: `node:http`, HTML em template strings, um script cliente de ~10 linhas servido em `/painel.js`.
- Única dependência de produção nova: `qrcode`; dev: `@types/qrcode`. `qrcode-terminal` sai na Task 9.
- `Service`, `parser`, `period`, `money`, `types.ts` e a interface `Repo` ficam **intactos** (só `presentation.ts` ganha duas mensagens, Task 5).
- Estilo do projeto: TypeScript `strict`, imports sem extensão (`'./service'`), comentários e mensagens em pt-BR, identificadores em pt-BR, valores em centavos.
- Toda mensagem de WhatsApp começa com emoji (o parser nunca pode ler resposta do bot como comando).
- Cadastro **fechado**: sem `CONVITE` configurado, nenhum cadastro é aceito.
- Senha: `scrypt` de `node:crypto`; mínimo de 8 caracteres. Sessão de login: cookie `sid` `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` quando há `DOMINIO`), 30 dias; no banco fica só o SHA-256 do token.
- Credenciais do Baileys: AES-256-GCM, chave `CHAVE_CRIPTO` (64 hex = 32 bytes). Nunca em claro no banco nem em log. QR e código de pareamento nunca em log.
- Toda mutação é `POST` e exige `Origin` com o mesmo host da requisição.
- Isolamento: toda rota resolve a conta pelo cookie; SSE e ações operam só na conta autenticada.
- `MAX_SESSOES` padrão 20; QR expira em 120 000 ms; lista de grupos em cache de 60 s por conta.
- Sem "🤖 Bot online" / "🤖 Bot desligando": só a boas-vindas ao escolher o grupo.
- Testes que precisam de banco usam `TEST_MONGO_URI` (padrão `mongodb://localhost:27017`) e o banco `wcoen_test`, como `tests/mongoRepo.test.ts`.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (segundo `-m`).

## Review Focus

Entradas e falhas que a spec implica mas que nenhum requisito nomeia; cada uma tem teste na task dona.

1. **Clique duplo / duas abas em "Conectar"** deve reaproveitar a mesma sessão (um socket só, nunca dois brigando). → Task 5
2. **E-mail com maiúsculas e espaços** (`  Ana@Email.COM `) cadastra e loga como o mesmo e-mail; duplicado em outra caixa é recusado. → Task 3
3. **POST forjado com `grupo` fora da lista** do cliente é recusado e nada é salvo/enviado. → Tasks 5 e 6
4. **HTML no e-mail ou no nome do grupo** (`<script>`) sai escapado no painel. → Task 6
5. **`CHAVE_CRIPTO` errada ou credencial ilegível** falha com erro claro **sem** sobrescrever credenciais existentes, e não derruba as demais contas. → Tasks 2 e 5
6. **Mensagem de outro grupo, ou de conta sem grupo escolhido**, é ignorada (nunca lançada). → Task 5

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/repo.ts` | modificar | `contaId` em todo acesso; `repoDe(contaId)`; índices por conta |
| `src/authstate.ts` | criar | auth state do Baileys no Mongo, criptografado |
| `src/contas.ts` | criar | cadastro, login, grupo, limitador de tentativas |
| `src/presentation.ts` | modificar | `BOAS_VINDAS` e `recuperados(n)` |
| `src/sessoes.ts` | criar | gerenciador de sessões (uma por conta) |
| `src/paginas.ts` | criar | HTML puro das páginas (separado de `web.ts` para manter os arquivos pequenos) |
| `src/web.ts` | criar | servidor HTTP, rotas, SSE, cookies, Origin |
| `src/migrar.ts`, `src/cli/migrar.ts`, `src/cli/senha.ts` | criar | migração dos dados legados e reset de senha |
| `src/config.ts` | modificar | novas variáveis; some `GROUP_ID` |
| `src/baileys.ts` | criar | fábrica real de socket (`criarSocketBaileys`) |
| `src/index.ts` | modificar | liga tudo |
| `src/whatsapp.ts` | **remover** | substituído por `sessoes.ts` + `baileys.ts` |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.dockerignore`, `.env.example`, `README.md`, `docs/roteiro-manual-portal.md` | criar/modificar | empacotamento e operação |

---

### Task 1: Repositório por conta

**Files:**
- Modify: `src/repo.ts`
- Modify: `src/index.ts:11,27` (provisório, reescrito na Task 9)
- Modify: `tests/repo.contract.ts` (assinatura + teste de isolamento)
- Modify: `tests/mongoRepo.test.ts`

**Interfaces:**
- Produces: `conectarMongo(uri: string, dbName: string): Promise<{ db: Db; repoDe: (contaId: string) => Repo; close: () => Promise<void> }>`. `contaId` é string (hex do `_id` da conta). O índice único antigo só de `msgId` é removido; entram `{contaId, msgId}` (único) e `{contaId, data}`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/repo.contract.ts`, mude a assinatura e acrescente o teste de isolamento no fim do `describe` (antes do `})` final da função):

```ts
export function repoContract(nome: string, criar: () => Promise<Repo>, criarPar?: () => Promise<[Repo, Repo]>) {
```

```ts
    if (criarPar) {
      it('isola contas: mesmo msgId em duas contas não colide e nada se mistura', async () => {
        const [a, b] = await criarPar()
        const l = novo({ msgId: 'mesmo' })
        expect(await a.add(l)).toBe('ok')
        expect(await b.add(l)).toBe('ok')
        await b.add(novo({ conta: 'luz', valor: 700 }))

        expect((await a.balancete(null)).despesas).toEqual([{ conta: 'mercado', total: 1000 }])
        expect((await b.balancete(null)).despesas).toEqual([{ conta: 'mercado', total: 1000 }, { conta: 'luz', total: 700 }])

        expect((await a.desfazerUltimo())?.conta).toBe('mercado')
        expect(await a.extrato({ de: new Date(0), ate: new Date('2100-01-01') })).toHaveLength(0)
        expect(await b.extrato({ de: new Date(0), ate: new Date('2100-01-01') })).toHaveLength(2) // b intacta
      })
    }
```

Substitua `tests/mongoRepo.test.ts` inteiro por:

```ts
import { afterAll, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { conectarMongo } from '../src/repo'
import { repoContract } from './repo.contract'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const DB = 'wcoen_test'

const limpador = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const fechar: Array<() => Promise<void>> = []

async function abrir() {
  await limpador.db(DB).collection('lancamentos').deleteMany({})
  const { repoDe, close } = await conectarMongo(URI, DB)
  fechar.push(close)
  return repoDe
}

repoContract(
  'MongoRepo',
  async () => (await abrir())('conta-teste'),
  async () => {
    const repoDe = await abrir()
    return [repoDe('a'), repoDe('b')]
  },
)

it('conectarMongo remove o índice único antigo só de msgId (dados legados)', async () => {
  const col = limpador.db(DB).collection('lancamentos')
  await col.deleteMany({})
  await col.createIndex({ msgId: 1 }, { unique: true, name: 'msgId_1' })
  const { repoDe, close } = await conectarMongo(URI, DB)
  fechar.push(close)
  const l = { tipo: 'despesa' as const, conta: 'x', valor: 1, remetente: 'u', msgId: 'igual', data: new Date(), enviadoEm: new Date() }
  expect(await repoDe('a').add(l)).toBe('ok')
  expect(await repoDe('b').add(l)).toBe('ok')
})

afterAll(async () => {
  await Promise.all(fechar.map((f) => f()))
  await limpador.close()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/mongoRepo.test.ts`
Expected: FAIL (`repoDe is not a function` ou erro de tipo).

- [ ] **Step 3: Implementar**

Em `src/repo.ts`, troque tudo por:

```ts
import { MongoClient, type Collection, type Filter } from 'mongodb'
import type { Balancete, Intervalo, Lancamento, Natureza, NovoLancamento, Repo } from './types'

type Doc = Lancamento & { contaId: string }

class MongoRepo implements Repo {
  constructor(
    private col: Collection<Doc>,
    private contaId: string,
  ) {}

  async add(l: NovoLancamento) {
    try {
      await this.col.insertOne({ ...l, contaId: this.contaId, desfeitoEm: null })
      return 'ok' as const
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return 'duplicado' as const // índice único (contaId, msgId)
      throw err
    }
  }

  async desfazerUltimo() {
    return this.col.findOneAndUpdate(
      { contaId: this.contaId, desfeitoEm: null },
      { $set: { desfeitoEm: new Date() } },
      { sort: { enviadoEm: -1, _id: -1 }, returnDocument: 'after' },
    )
  }

  async extrato(intervalo: { de: Date; ate: Date }) {
    return this.col
      .find({ contaId: this.contaId, desfeitoEm: null, data: { $gte: intervalo.de, $lt: intervalo.ate } })
      .sort({ data: 1, enviadoEm: 1, _id: 1 })
      .toArray()
  }

  async balancete(intervalo: Intervalo): Promise<Balancete> {
    const match: Filter<Doc> = { contaId: this.contaId, desfeitoEm: null }
    if (intervalo) match.data = { $gte: intervalo.de, $lt: intervalo.ate }
    const grupos = await this.col
      .aggregate<{ _id: { tipo: Natureza; conta: string }; total: number }>([
        { $match: match },
        { $group: { _id: { tipo: '$tipo', conta: '$conta' }, total: { $sum: '$valor' } } },
        { $sort: { total: -1, '_id.conta': 1 } },
      ])
      .toArray()
    const linhas = (t: Natureza) =>
      grupos.filter((g) => g._id.tipo === t).map((g) => ({ conta: g._id.conta, total: g.total }))
    return { receitas: linhas('receita'), despesas: linhas('despesa') }
  }
}

export async function conectarMongo(uri: string, dbName: string) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  await client.connect()
  const db = client.db(dbName)
  const col = db.collection<Doc>('lancamentos')
  // o índice único antigo (só msgId) impediria o mesmo msgId em contas diferentes
  await col.dropIndex('msgId_1').catch((err: { code?: number }) => {
    if (err.code !== 26 && err.code !== 27) throw err // 26 = coleção inexistente, 27 = índice inexistente
  })
  await col.createIndex({ contaId: 1, msgId: 1 }, { unique: true })
  await col.createIndex({ contaId: 1, data: 1 })
  return { db, repoDe: (contaId: string) => new MongoRepo(col, contaId) as Repo, close: () => client.close() }
}
```

Em `src/index.ts`, troque `mongo.repo` por `mongo.repoDe('legado')` (provisório: a Task 9 reescreve este arquivo; até lá o bot antigo continua compilando):

```ts
const service = new Service(mongo.repoDe('legado'), undefined, auditor) // ponytail: provisório até a Task 9 do plano portal-saas
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/mongoRepo.test.ts tests/memoryRepo.test.ts && npm run typecheck`
Expected: PASS (Mongo do Docker de pé), typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/repo.ts src/index.ts tests/repo.contract.ts tests/mongoRepo.test.ts
git commit -m "feat: repositório por conta (repoDe) com índices (contaId, msgId)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Estado de autenticação criptografado no Mongo

**Files:**
- Create: `src/authstate.ts`
- Test: `tests/authstate.test.ts`

**Interfaces:**
- Produces:
  - `type DocAuth = { contaId: string; chave: string; valor: string }`
  - `cifrar(texto: string, chave: Buffer): string` / `decifrar(valor: string, chave: Buffer): string`
  - `garantirIndiceAuth(col: Collection<DocAuth>): Promise<void>`
  - `criarAuthState(col: Collection<DocAuth>, contaId: string, chave: Buffer): Promise<{ state: AuthenticationState; saveCreds: () => Promise<unknown> }>`
  - `apagarAuth(col: Collection<DocAuth>, contaId: string): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

`tests/authstate.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { MongoClient } from 'mongodb'
import { apagarAuth, cifrar, criarAuthState, decifrar, garantirIndiceAuth, type DocAuth } from '../src/authstate'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const col = client.db('wcoen_test').collection<DocAuth>('wa_auth')
const chave = randomBytes(32)

beforeEach(async () => {
  await col.deleteMany({})
  await garantirIndiceAuth(col)
})
afterAll(() => client.close())

describe('cifrar/decifrar', () => {
  it('ida e volta; cada cifra é diferente; chave errada falha', () => {
    const c1 = cifrar('segredo', chave)
    expect(decifrar(c1, chave)).toBe('segredo')
    expect(cifrar('segredo', chave)).not.toBe(c1) // IV aleatório
    expect(() => decifrar(c1, randomBytes(32))).toThrow()
  })
})

describe('criarAuthState', () => {
  it('conta nova nasce com credenciais e as recupera depois de salvar', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    const b = await criarAuthState(col, 'c1', chave)
    expect(b.state.creds.registrationId).toBe(a.state.creds.registrationId)
    expect(b.state.creds.noiseKey.private.equals(a.state.creds.noiseKey.private)).toBe(true)
  })

  it('grava, lê e apaga chaves de sinal', async () => {
    const { state } = await criarAuthState(col, 'c1', chave)
    await state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } })
    const lido = await state.keys.get('pre-key', ['1', '2'])
    expect(lido['1'].private.toString()).toBe('a')
    expect(lido['2']).toBeFalsy()
    await state.keys.set({ 'pre-key': { '1': null } })
    expect((await state.keys.get('pre-key', ['1']))['1']).toBeFalsy()
  })

  it('o documento bruto no Mongo não contém credencial em claro', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    await a.state.keys.set({ 'pre-key': { '1': { private: Buffer.from('a'), public: Buffer.from('b') } } })
    const bruto = JSON.stringify(await col.find({ contaId: 'c1' }).toArray())
    expect(bruto).not.toContain('noiseKey')
    expect(bruto).not.toContain('registrationId')
    expect(bruto).not.toContain('private')
  })

  it('contas são isoladas e apagarAuth só apaga a indicada', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    const b = await criarAuthState(col, 'c2', chave)
    await b.saveCreds()
    expect(b.state.creds.registrationId).not.toBe(a.state.creds.registrationId)
    await apagarAuth(col, 'c1')
    expect(await col.countDocuments({ contaId: 'c1' })).toBe(0)
    expect(await col.countDocuments({ contaId: 'c2' })).toBe(1)
  })

  it('CHAVE_CRIPTO errada: erro claro e as credenciais gravadas não são sobrescritas', async () => {
    const a = await criarAuthState(col, 'c1', chave)
    await a.saveCreds()
    const antes = await col.findOne({ contaId: 'c1', chave: 'creds' })
    await expect(criarAuthState(col, 'c1', randomBytes(32))).rejects.toThrow('CHAVE_CRIPTO')
    expect((await col.findOne({ contaId: 'c1', chave: 'creds' }))?.valor).toBe(antes?.valor)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/authstate.test.ts`
Expected: FAIL (`Cannot find module '../src/authstate'`).

- [ ] **Step 3: Implementar**

`src/authstate.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from '@whiskeysockets/baileys'
import type { Collection } from 'mongodb'

export type DocAuth = { contaId: string; chave: string; valor: string }

// AES-256-GCM; o valor guardado é base64(iv[12] | tag[16] | texto cifrado)
export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chave, iv)
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64')
}

export function decifrar(valor: string, chave: Buffer): string {
  const b = Buffer.from(valor, 'base64')
  const d = createDecipheriv('aes-256-gcm', chave, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
}

export async function garantirIndiceAuth(col: Collection<DocAuth>) {
  await col.createIndex({ contaId: 1, chave: 1 }, { unique: true })
}

export async function apagarAuth(col: Collection<DocAuth>, contaId: string) {
  await col.deleteMany({ contaId })
}

// Mesmo contrato do useMultiFileAuthState do Baileys, mas no Mongo, por conta e criptografado.
export async function criarAuthState(col: Collection<DocAuth>, contaId: string, chave: Buffer) {
  const gravar = (k: string, v: unknown) =>
    col.updateOne({ contaId, chave: k }, { $set: { valor: cifrar(JSON.stringify(v, BufferJSON.replacer), chave) } }, { upsert: true })
  const remover = (k: string) => col.deleteOne({ contaId, chave: k })
  const ler = async (k: string) => {
    const d = await col.findOne({ contaId, chave: k })
    if (!d) return null
    try {
      return JSON.parse(decifrar(d.valor, chave), BufferJSON.reviver)
    } catch {
      // nunca devolver null aqui: o Baileys criaria credenciais novas e sobrescreveria as gravadas
      throw new Error('CHAVE_CRIPTO não confere com a usada ao gravar as credenciais')
    }
  }

  const creds = (await ler('creds')) ?? initAuthCreds()
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const data: { [id: string]: any } = {}
        await Promise.all(
          ids.map(async (id) => {
            let v = await ler(`${type}-${id}`)
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v)
            data[id] = v
          }),
        )
        return data
      },
      set: async (data) => {
        const tarefas: Promise<unknown>[] = []
        for (const [categoria, itens] of Object.entries(data as Record<string, Record<string, unknown>>)) {
          for (const [id, v] of Object.entries(itens)) tarefas.push(v ? gravar(`${categoria}-${id}`, v) : remover(`${categoria}-${id}`))
        }
        await Promise.all(tarefas)
      },
    },
  }
  return { state, saveCreds: () => gravar('creds', creds) }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/authstate.test.ts && npm run typecheck`
Expected: PASS, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/authstate.ts tests/authstate.test.ts
git commit -m "feat: auth state do Baileys no Mongo, por conta e criptografado (AES-256-GCM)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Contas, login e limitador de tentativas

**Files:**
- Create: `src/contas.ts`
- Test: `tests/contas.test.ts`, `tests/limitador.test.ts`

**Interfaces:**
- Produces:
  - `type Conta = { id: string; email: string; grupoId?: string; grupoNome?: string }`
  - `type ErroCadastro = 'convite_invalido' | 'email_invalido' | 'senha_curta' | 'email_em_uso'`
  - `criarContas(db: Db, opcoes: { convite: string }): Promise<Contas>` com os métodos:
    - `cadastrar(email, senha, convite): Promise<{ ok: true; conta: Conta } | { ok: false; erro: ErroCadastro }>`
    - `verificar(email, senha): Promise<Conta | null>`
    - `criarLogin(contaId): Promise<string>` (token) · `contaDoLogin(token): Promise<Conta | null>` · `encerrarLogin(token): Promise<void>`
    - `porId(contaId): Promise<Conta | null>`
    - `definirGrupo(contaId, grupoId, grupoNome): Promise<void>`
    - `marcarConectada(contaId, conectada: boolean): Promise<void>` · `conectadas(): Promise<string[]>`
    - `redefinirSenha(email, senha): Promise<boolean>`
  - `type Contas = Awaited<ReturnType<typeof criarContas>>`
  - `criarLimitador(max: number, janelaMs: number, agora?: () => number): { bloqueado(k: string): boolean; falhou(k: string): void; limpar(k: string): void }`

- [ ] **Step 1: Escrever os testes que falham**

`tests/limitador.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { criarLimitador } from '../src/contas'

describe('criarLimitador', () => {
  it('bloqueia depois de N falhas na janela e libera com o tempo', () => {
    let t = 0
    const l = criarLimitador(3, 1000, () => t)
    for (let i = 0; i < 3; i++) l.falhou('k')
    expect(l.bloqueado('k')).toBe(true)
    expect(l.bloqueado('outra')).toBe(false)
    t = 1001
    expect(l.bloqueado('k')).toBe(false)
  })

  it('limpar zera a contagem', () => {
    const l = criarLimitador(1, 1000)
    l.falhou('k')
    expect(l.bloqueado('k')).toBe(true)
    l.limpar('k')
    expect(l.bloqueado('k')).toBe(false)
  })
})
```

`tests/contas.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { criarContas, type Contas } from '../src/contas'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const db = client.db('wcoen_test')
let contas: Contas

beforeEach(async () => {
  await db.collection('contas').deleteMany({})
  await db.collection('logins').deleteMany({})
  contas = await criarContas(db, { convite: 'segredo' })
})
afterAll(() => client.close())

const cadastrar = (email = 'ana@x.com', senha = 'senha-boa-123', convite = 'segredo') => contas.cadastrar(email, senha, convite)

describe('cadastro', () => {
  it('cria a conta e devolve o id', async () => {
    const r = await cadastrar()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.conta).toMatchObject({ email: 'ana@x.com' })
  })

  it('e-mail com maiúsculas e espaços é normalizado; duplicado em outra caixa é recusado', async () => {
    const r = await cadastrar('  Ana@X.COM ')
    expect(r.ok && r.conta.email).toBe('ana@x.com')
    expect(await cadastrar('ANA@x.com')).toEqual({ ok: false, erro: 'email_em_uso' })
    expect(await contas.verificar('  ANA@x.com ', 'senha-boa-123')).not.toBeNull()
  })

  it('recusa convite errado, e-mail inválido e senha curta', async () => {
    expect(await cadastrar('ana@x.com', 'senha-boa-123', 'errado')).toEqual({ ok: false, erro: 'convite_invalido' })
    expect(await cadastrar('sem-arroba', 'senha-boa-123')).toEqual({ ok: false, erro: 'email_invalido' })
    expect(await cadastrar('ana@x.com', '1234567')).toEqual({ ok: false, erro: 'senha_curta' })
  })

  it('sem convite configurado, ninguém se cadastra', async () => {
    const fechado = await criarContas(db, { convite: '' })
    expect(await fechado.cadastrar('ana@x.com', 'senha-boa-123', '')).toEqual({ ok: false, erro: 'convite_invalido' })
  })
})

describe('login', () => {
  it('verificar: senha certa devolve a conta; errada ou e-mail desconhecido, null', async () => {
    await cadastrar()
    expect((await contas.verificar('ana@x.com', 'senha-boa-123'))?.email).toBe('ana@x.com')
    expect(await contas.verificar('ana@x.com', 'outra-senha')).toBeNull()
    expect(await contas.verificar('ninguem@x.com', 'senha-boa-123')).toBeNull()
  })

  it('token de login resolve a conta; encerrar invalida; token desconhecido é null', async () => {
    const r = await cadastrar()
    if (!r.ok) throw new Error('cadastro')
    const token = await contas.criarLogin(r.conta.id)
    expect((await contas.contaDoLogin(token))?.id).toBe(r.conta.id)
    await contas.encerrarLogin(token)
    expect(await contas.contaDoLogin(token)).toBeNull()
    expect(await contas.contaDoLogin('desconhecido')).toBeNull()
  })

  it('login expirado não vale (mesmo antes do TTL do Mongo limpar)', async () => {
    const r = await cadastrar()
    if (!r.ok) throw new Error('cadastro')
    const token = await contas.criarLogin(r.conta.id)
    await db.collection('logins').updateMany({}, { $set: { expiraEm: new Date(Date.now() - 1000) } })
    expect(await contas.contaDoLogin(token)).toBeNull()
  })

  it('no banco fica só o hash do token, nunca o token', async () => {
    const r = await cadastrar()
    if (!r.ok) throw new Error('cadastro')
    const token = await contas.criarLogin(r.conta.id)
    expect(JSON.stringify(await db.collection('logins').find().toArray())).not.toContain(token)
  })
})

describe('grupo, conexão e senha', () => {
  it('definirGrupo e marcarConectada/conectadas', async () => {
    const r = await cadastrar()
    if (!r.ok) throw new Error('cadastro')
    await contas.definirGrupo(r.conta.id, 'g1@g.us', 'Casa')
    expect(await contas.porId(r.conta.id)).toMatchObject({ grupoId: 'g1@g.us', grupoNome: 'Casa' })
    expect(await contas.conectadas()).toEqual([])
    await contas.marcarConectada(r.conta.id, true)
    expect(await contas.conectadas()).toEqual([r.conta.id])
    await contas.marcarConectada(r.conta.id, false)
    expect(await contas.conectadas()).toEqual([])
  })

  it('porId com id inválido devolve null', async () => {
    expect(await contas.porId('não-é-objectid')).toBeNull()
  })

  it('redefinirSenha troca a senha e derruba os logins', async () => {
    const r = await cadastrar()
    if (!r.ok) throw new Error('cadastro')
    const token = await contas.criarLogin(r.conta.id)
    expect(await contas.redefinirSenha('ANA@x.com', 'nova-senha-123')).toBe(true)
    expect(await contas.verificar('ana@x.com', 'senha-boa-123')).toBeNull()
    expect(await contas.verificar('ana@x.com', 'nova-senha-123')).not.toBeNull()
    expect(await contas.contaDoLogin(token)).toBeNull()
    expect(await contas.redefinirSenha('ninguem@x.com', 'nova-senha-123')).toBe(false)
    expect(await contas.redefinirSenha('ana@x.com', 'curta')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/contas.test.ts tests/limitador.test.ts`
Expected: FAIL (`Cannot find module '../src/contas'`).

- [ ] **Step 3: Implementar**

`src/contas.ts`:

```ts
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { ObjectId, type Db } from 'mongodb'

const scrypt = promisify(scryptCb) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>
const TRINTA_DIAS_MS = 30 * 24 * 3600_000
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export type Conta = { id: string; email: string; grupoId?: string; grupoNome?: string }
export type ErroCadastro = 'convite_invalido' | 'email_invalido' | 'senha_curta' | 'email_em_uso'
type DocConta = { _id: ObjectId; email: string; senhaHash: string; criadaEm: Date; grupoId?: string; grupoNome?: string; conectada?: boolean }
type DocLogin = { _id: string; contaId: string; expiraEm: Date } // _id = SHA-256 do token

const normalizar = (email: string) => email.trim().toLowerCase()
const paraConta = (d: DocConta): Conta => ({ id: d._id.toHexString(), email: d.email, grupoId: d.grupoId, grupoNome: d.grupoNome })
const sha256 = (s: string) => createHash('sha256').update(s).digest()
const igual = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b))

async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16)
  return `scrypt$${sal.toString('hex')}$${(await scrypt(senha, sal, 64)).toString('hex')}`
}

async function senhaConfere(senha: string, hash: string): Promise<boolean> {
  const [, sal, esperado] = hash.split('$')
  const obtido = await scrypt(senha, Buffer.from(sal, 'hex'), 64)
  const alvo = Buffer.from(esperado, 'hex')
  return obtido.length === alvo.length && timingSafeEqual(obtido, alvo)
}

export async function criarContas(db: Db, { convite }: { convite: string }) {
  const contas = db.collection<DocConta>('contas')
  const logins = db.collection<DocLogin>('logins')
  await contas.createIndex({ email: 1 }, { unique: true })
  await logins.createIndex({ expiraEm: 1 }, { expireAfterSeconds: 0 })
  const hashFalso = await hashSenha('senha-inexistente') // e-mail desconhecido gasta o mesmo tempo de um conhecido

  const porId = async (id: string): Promise<Conta | null> => {
    if (!ObjectId.isValid(id)) return null
    const d = await contas.findOne({ _id: new ObjectId(id) })
    return d ? paraConta(d) : null
  }

  return {
    porId,

    async cadastrar(email: string, senha: string, conviteInformado: string): Promise<{ ok: true; conta: Conta } | { ok: false; erro: ErroCadastro }> {
      const e = normalizar(email)
      if (!convite || !igual(conviteInformado, convite)) return { ok: false, erro: 'convite_invalido' } // sem convite configurado, ninguém entra
      if (!EMAIL.test(e)) return { ok: false, erro: 'email_invalido' }
      if (senha.length < 8) return { ok: false, erro: 'senha_curta' }
      const doc: DocConta = { _id: new ObjectId(), email: e, senhaHash: await hashSenha(senha), criadaEm: new Date() }
      try {
        await contas.insertOne(doc)
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return { ok: false, erro: 'email_em_uso' }
        throw err
      }
      return { ok: true, conta: paraConta(doc) }
    },

    async verificar(email: string, senha: string): Promise<Conta | null> {
      const d = await contas.findOne({ email: normalizar(email) })
      const ok = await senhaConfere(senha, d?.senhaHash ?? hashFalso)
      return d && ok ? paraConta(d) : null
    },

    async criarLogin(contaId: string): Promise<string> {
      const token = randomBytes(32).toString('base64url')
      await logins.insertOne({ _id: sha256(token).toString('hex'), contaId, expiraEm: new Date(Date.now() + TRINTA_DIAS_MS) })
      return token
    },

    async contaDoLogin(token: string): Promise<Conta | null> {
      const l = await logins.findOne({ _id: sha256(token).toString('hex') })
      if (!l || l.expiraEm.getTime() <= Date.now()) return null // o TTL do Mongo só limpa a cada ~60 s
      return porId(l.contaId)
    },

    async encerrarLogin(token: string) {
      await logins.deleteOne({ _id: sha256(token).toString('hex') })
    },

    async definirGrupo(contaId: string, grupoId: string, grupoNome: string) {
      await contas.updateOne({ _id: new ObjectId(contaId) }, { $set: { grupoId, grupoNome } })
    },

    async marcarConectada(contaId: string, conectada: boolean) {
      await contas.updateOne({ _id: new ObjectId(contaId) }, { $set: { conectada } })
    },

    async conectadas(): Promise<string[]> {
      return (await contas.find({ conectada: true }, { projection: { _id: 1 } }).toArray()).map((d) => d._id.toHexString())
    },

    async redefinirSenha(email: string, senha: string): Promise<boolean> {
      if (senha.length < 8) return false
      const e = normalizar(email)
      const r = await contas.findOneAndUpdate({ email: e }, { $set: { senhaHash: await hashSenha(senha) } })
      if (!r) return false
      await logins.deleteMany({ contaId: r._id.toHexString() })
      return true
    },
  }
}

export type Contas = Awaited<ReturnType<typeof criarContas>>

// ponytail: em memória, as chaves só saem quando consultadas de novo. Basta para pilotos; com muito tráfego, expirar por varredura.
export function criarLimitador(max: number, janelaMs: number, agora: () => number = Date.now) {
  const falhas = new Map<string, number[]>()
  const recentes = (k: string) => {
    const lista = (falhas.get(k) ?? []).filter((t) => t > agora() - janelaMs)
    falhas.set(k, lista)
    return lista
  }
  return {
    bloqueado: (k: string) => recentes(k).length >= max,
    falhou: (k: string) => {
      recentes(k).push(agora())
    },
    limpar: (k: string) => {
      falhas.delete(k)
    },
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/contas.test.ts tests/limitador.test.ts && npm run typecheck`
Expected: PASS, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/contas.ts tests/contas.test.ts tests/limitador.test.ts
git commit -m "feat: contas (cadastro por convite, login com scrypt, sessão por cookie) e limitador de tentativas" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Mensagens novas na camada de apresentação

**Files:**
- Modify: `src/presentation.ts` (acrescentar no fim da seção "ajuda, uso e erros")
- Modify: `tests/presentation.test.ts`

**Interfaces:**
- Produces: `BOAS_VINDAS: string` e `recuperados(n: number): string` (consumidos pela Task 5).

- [ ] **Step 1: Escrever o teste que falha**

No fim de `tests/presentation.test.ts` acrescente (e inclua `BOAS_VINDAS, recuperados` no import de `../src/presentation`):

```ts
describe('mensagens do gerenciador de sessões', () => {
  it('boas-vindas', () => {
    expect(BOAS_VINDAS).toBe('✅ *CONECTADO*\n\n_Digite *ajuda* para ver os comandos._')
  })
  it('recuperados: singular e plural', () => {
    expect(recuperados(1)).toBe('📥 *LANÇAMENTOS RECUPERADOS*\n\n_1 lançamento feito enquanto eu estava offline._')
    expect(recuperados(3)).toBe('📥 *LANÇAMENTOS RECUPERADOS*\n\n_3 lançamentos feitos enquanto eu estava offline._')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/presentation.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Implementar**

Em `src/presentation.ts`, logo antes de `const uso = (...comandos: string[])`, acrescente:

```ts
export const BOAS_VINDAS = `${cabecalho('✅', 'CONECTADO')}\n\n${italic(`Digite ${bold('ajuda')} para ver os comandos.`)}`

export const recuperados = (n: number) =>
  `${cabecalho('📥', 'LANÇAMENTOS RECUPERADOS')}\n\n${italic(`${n} lançamento${n > 1 ? 's' : ''} feito${n > 1 ? 's' : ''} enquanto eu estava offline.`)}`
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/presentation.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation.ts tests/presentation.test.ts
git commit -m "feat: mensagens de boas-vindas e de lançamentos recuperados" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Gerenciador de sessões

**Files:**
- Create: `src/sessoes.ts`
- Test: `tests/sessoes.test.ts`

**Interfaces:**
- Consumes: `atrasoReconexao` (`src/backoff.ts`); `BOAS_VINDAS`, `recuperados` (Task 4); tipos `Mensagem`, `Resposta` de `src/service`.
- Produces (usados pelas Tasks 6 e 8):
  - `type Estado = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado'`
  - `type Aviso = 'qr_expirado' | 'sessao_encerrada' | 'sessao_assumida' | 'servidor_lotado' | 'erro'`
  - `type Visao = { estado: Estado; qr?: string; codigo?: string; aviso?: Aviso }`
  - `type SocketMin`, `type Auth = { state: AuthenticationState; saveCreds: () => Promise<unknown> }`, `type ServicoDaConta`, `type DepsSessoes`
  - `criarSessoes(deps: DepsSessoes)` → `Sessoes` com: `iniciar(contaId): Promise<void>`, `visao(contaId): Visao`, `assinar(contaId, cb: (v: Visao) => void): () => void`, `grupos(contaId): Promise<{ id: string; nome: string }[]>`, `definirGrupo(contaId, grupoId): Promise<void>` (lança `Error('grupo_invalido')` ou `Error('nao_conectado')`), `parear(contaId, telefone): Promise<string>` (lança `Error('telefone_invalido')` ou `Error('indisponivel')`), `desconectar(contaId): Promise<void>`, `reabrir(contaIds: string[], intervaloMs?: number): Promise<void>`, `encerrar(): Promise<void>`
  - `type Sessoes = ReturnType<typeof criarSessoes>`

- [ ] **Step 1: Escrever os testes que falham**

`tests/sessoes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarSessoes, type DepsSessoes } from '../src/sessoes'
import { BOAS_VINDAS, recuperados } from '../src/presentation'
import type { Mensagem, Resposta } from '../src/service'

class SocketFalso {
  ouvintes: Record<string, Array<(dados: any) => void>> = {}
  ev = { on: (evento: string, f: (dados: any) => void) => { (this.ouvintes[evento] ??= []).push(f) } }
  user = { id: '5511999999999:1@s.whatsapp.net' }
  enviadas: { jid: string; texto: string }[] = []
  sendMessage = vi.fn(async (jid: string, c: { text: string }) => {
    this.enviadas.push({ jid, texto: c.text })
    return { key: { id: `saida${this.enviadas.length}` } }
  })
  groupFetchAllParticipating = vi.fn(async () => ({
    'g1@g.us': { id: 'g1@g.us', subject: 'Casa' },
    'g2@g.us': { id: 'g2@g.us', subject: 'Amigos' },
  }))
  requestPairingCode = vi.fn(async (_telefone: string) => 'ABCD1234')
  logout = vi.fn(async () => {})
  end = vi.fn((_erro?: Error) => {})
  emitir(evento: string, dados: unknown) {
    for (const f of this.ouvintes[evento] ?? []) f(dados)
  }
}

const AGORA_S = 1_700_000_000 // instante do "relógio" dos testes, em segundos
const fecha = (codigo: number) => ({ error: { output: { statusCode: codigo } } })
let n = 0
const upsert = (jid: string, texto: string, ts = AGORA_S + 10, id = `id${++n}`) => ({
  type: 'notify',
  messages: [{ key: { id, remoteJid: jid, fromMe: false, participant: 'u@s.whatsapp.net' }, message: { conversation: texto }, messageTimestamp: ts }],
})

function montar(extra: Partial<DepsSessoes> = {}) {
  const socks: SocketFalso[] = []
  const relogio = { ms: AGORA_S * 1000 }
  const handle = vi.fn(async (_m: Mensagem, _o: { recuperada?: boolean }): Promise<Resposta | null> => ({ texto: 'ok', lancou: false }))
  const grupos = new Map<string, string>()
  const conectadas = new Map<string, boolean>()
  const deps: DepsSessoes = {
    criarAuth: async () => ({ state: {} as never, saveCreds: async () => {} }),
    apagarAuth: vi.fn(async (_id: string) => {}),
    criarSocket: async () => {
      const s = new SocketFalso()
      socks.push(s)
      return s
    },
    criarService: () => ({ handle }),
    grupoDa: async (id) => grupos.get(id),
    salvarGrupo: vi.fn(async (id: string, g: string) => { grupos.set(id, g) }),
    marcarConectada: async (id, v) => { conectadas.set(id, v) },
    dormir: async () => {},
    agora: () => relogio.ms,
    ...extra,
  }
  return { sessoes: criarSessoes(deps), socks, handle, grupos, conectadas, deps, relogio }
}

const abrir = async (m: ReturnType<typeof montar>, conta = 'a', i = 0) => {
  await m.sessoes.iniciar(conta)
  m.socks[i].emitir('connection.update', { connection: 'open' })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('conexão e estados', () => {
  it('iniciar → conectando; QR → aguardando_qr; open → conectado e marcada', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    expect(m.sessoes.visao('a')).toEqual({ estado: 'conectando' })
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'aguardando_qr', qr: 'QR1' })
    m.socks[0].emitir('connection.update', { connection: 'open' })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'conectado' })
    expect(m.conectadas.get('a')).toBe(true)
  })

  it('clique duplo / duas abas: iniciar de novo reaproveita a sessão (um socket só)', async () => {
    const m = montar()
    await Promise.all([m.sessoes.iniciar('a'), m.sessoes.iniciar('a')])
    await m.sessoes.iniciar('a')
    expect(m.socks).toHaveLength(1)
  })

  it('QR não escaneado expira em 2 min: fecha o socket, avisa e ignora o "close" tardio', async () => {
    vi.useFakeTimers()
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'qr_expirado' })
    expect(m.socks[0].end).toHaveBeenCalled()
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(408) })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(1)
    expect(m.sessoes.visao('a').estado).toBe('desconectado')
  })

  it('timeout do próprio Baileys (408) durante o QR também vira "qr_expirado"', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(408) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'qr_expirado' })
  })

  it('código 515 depois do pareamento recria o socket, sem virar erro', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(515) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'conectando' })
    await vi.waitFor(() => expect(m.socks).toHaveLength(2))
    m.socks[1].emitir('connection.update', { connection: 'open' })
    expect(m.sessoes.visao('a').estado).toBe('conectado')
  })

  it('loggedOut (401): apaga as credenciais, desmarca e não reconecta', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(401) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'sessao_encerrada' })
    expect(m.deps.apagarAuth).toHaveBeenCalledWith('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(m.conectadas.get('a')).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(1)
  })

  it('connectionReplaced (440): desconectado, sem retry automático', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(440) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'sessao_assumida' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(1)
  })

  it('queda de rede: mostra "conectando" e reconecta com backoff', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(500) })
    expect(m.sessoes.visao('a').estado).toBe('conectando')
    expect(m.socks).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.socks).toHaveLength(2)
  })

  it('MAX_SESSOES: a excedente fica desconectada com aviso "servidor_lotado"', async () => {
    const m = montar({ maxSessoes: 1 })
    await m.sessoes.iniciar('a')
    await m.sessoes.iniciar('b')
    expect(m.sessoes.visao('b')).toEqual({ estado: 'desconectado', aviso: 'servidor_lotado' })
    expect(m.socks).toHaveLength(1)
  })

  it('falha ao abrir uma conta (ex.: CHAVE_CRIPTO errada) fica isolada nela', async () => {
    const m = montar({
      criarAuth: async (id) => {
        if (id === 'a') throw new Error('CHAVE_CRIPTO não confere')
        return { state: {} as never, saveCreds: async () => {} }
      },
    })
    await m.sessoes.iniciar('a')
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'erro' })
    await m.sessoes.iniciar('b')
    expect(m.sessoes.visao('b').estado).toBe('conectando')
    expect(m.socks).toHaveLength(1)
  })
})

describe('mensagens', () => {
  it('sem grupo escolhido nada é processado; depois de escolher, só o grupo escolhido', async () => {
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'mercado 10'))
    await m.sessoes.definirGrupo('a', 'g1@g.us')
    expect(m.handle).not.toHaveBeenCalled() // a mensagem anterior à escolha foi ignorada
    m.socks[0].emitir('messages.upsert', upsert('g2@g.us', 'outro grupo'))
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'luz 20', undefined, 'certa'))
    await vi.waitFor(() => expect(m.handle).toHaveBeenCalledTimes(1))
    expect(m.handle.mock.calls[0][0]).toMatchObject({ msgId: 'certa', texto: 'luz 20' })
  })

  it('grupo salvo é carregado ao abrir e a resposta vai para o grupo', async () => {
    const m = montar()
    m.grupos.set('a', 'g1@g.us')
    m.handle.mockResolvedValue({ texto: 'olá', lancou: false })
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'oi'))
    await vi.waitFor(() => expect(m.socks[0].enviadas).toEqual([{ jid: 'g1@g.us', texto: 'olá' }]))
  })

  it('anti-loop: o eco da própria resposta não é tratado de novo', async () => {
    const m = montar()
    m.grupos.set('a', 'g1@g.us')
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'oi'))
    await vi.waitFor(() => expect(m.socks[0].enviadas).toHaveLength(1))
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'ok', undefined, 'saida1'))
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'fim', undefined, 'sentinela'))
    await vi.waitFor(() => expect(m.handle).toHaveBeenCalledTimes(2))
    expect(m.handle.mock.calls.map((c) => c[0].msgId)).not.toContain('saida1')
  })

  it('mensagem anterior à conexão é "recuperada"; se lançou, só um resumo depois de 5 s', async () => {
    vi.useFakeTimers()
    const m = montar()
    m.grupos.set('a', 'g1@g.us')
    m.handle.mockResolvedValue({ texto: 'x', lancou: true })
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'mercado 10', AGORA_S - 1000, 'velha'))
    await vi.advanceTimersByTimeAsync(0)
    expect(m.handle).toHaveBeenCalledWith(expect.objectContaining({ msgId: 'velha' }), { recuperada: true })
    expect(m.socks[0].enviadas).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(m.socks[0].enviadas.map((e) => e.texto)).toEqual([recuperados(1)])
  })

  it('erro ao tratar uma mensagem fica isolado: outra conta segue funcionando', async () => {
    const boa = vi.fn(async (): Promise<Resposta | null> => ({ texto: 'ok', lancou: false }))
    const m = montar({ criarService: (id) => ({ handle: id === 'a' ? vi.fn().mockRejectedValue(new Error('boom')) : boa }) })
    m.grupos.set('a', 'g1@g.us')
    m.grupos.set('b', 'g1@g.us')
    await abrir(m, 'a', 0)
    await abrir(m, 'b', 1)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'x'))
    m.socks[1].emitir('messages.upsert', upsert('g1@g.us', 'y'))
    await vi.waitFor(() => expect(boa).toHaveBeenCalled())
    expect(console.error).toHaveBeenCalled()
    expect(m.sessoes.visao('a').estado).toBe('conectado')
  })
})

describe('grupos', () => {
  it('lista em ordem alfabética e usa cache de 60 s', async () => {
    const m = montar()
    await abrir(m)
    expect(await m.sessoes.grupos('a')).toEqual([{ id: 'g2@g.us', nome: 'Amigos' }, { id: 'g1@g.us', nome: 'Casa' }])
    await m.sessoes.grupos('a')
    expect(m.socks[0].groupFetchAllParticipating).toHaveBeenCalledTimes(1)
    m.relogio.ms += 61_000
    await m.sessoes.grupos('a')
    expect(m.socks[0].groupFetchAllParticipating).toHaveBeenCalledTimes(2)
  })

  it('não conectada: lista vazia', async () => {
    expect(await montar().sessoes.grupos('a')).toEqual([])
  })

  it('definirGrupo salva e manda a boas-vindas ao grupo', async () => {
    const m = montar()
    await abrir(m)
    await m.sessoes.definirGrupo('a', 'g1@g.us')
    expect(m.deps.salvarGrupo).toHaveBeenCalledWith('a', 'g1@g.us', 'Casa')
    expect(m.socks[0].enviadas).toEqual([{ jid: 'g1@g.us', texto: BOAS_VINDAS }])
  })

  it('id de grupo forjado (fora da lista da conta) é recusado sem salvar nem enviar', async () => {
    const m = montar()
    await abrir(m)
    await expect(m.sessoes.definirGrupo('a', 'invasor@g.us')).rejects.toThrow('grupo_invalido')
    expect(m.deps.salvarGrupo).not.toHaveBeenCalled()
    expect(m.socks[0].enviadas).toEqual([])
  })

  it('definirGrupo sem estar conectada é recusado', async () => {
    await expect(montar().sessoes.definirGrupo('a', 'g1@g.us')).rejects.toThrow('nao_conectado')
  })
})

describe('código de pareamento', () => {
  it('só com o QR pronto; limpa o número; devolve o código e o expõe na visão', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    await expect(m.sessoes.parear('a', '5511999999999')).rejects.toThrow('indisponivel') // ainda sem QR
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    expect(await m.sessoes.parear('a', '+55 (11) 99999-9999')).toBe('ABCD1234')
    expect(m.socks[0].requestPairingCode).toHaveBeenCalledWith('5511999999999')
    expect(m.sessoes.visao('a').codigo).toBe('ABCD1234')
  })

  it('recusa telefone com menos de 10 ou mais de 15 dígitos', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    await expect(m.sessoes.parear('a', '123')).rejects.toThrow('telefone_invalido')
    await expect(m.sessoes.parear('a', '1'.repeat(16))).rejects.toThrow('telefone_invalido')
  })
})

describe('desconectar, assinar, reabrir, encerrar', () => {
  it('desconectar faz logout, apaga credenciais, desmarca e volta a desconectado', async () => {
    const m = montar()
    await abrir(m)
    await m.sessoes.desconectar('a')
    expect(m.socks[0].logout).toHaveBeenCalled()
    expect(m.deps.apagarAuth).toHaveBeenCalledWith('a')
    expect(m.conectadas.get('a')).toBe(false)
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado' })
    await m.sessoes.iniciar('a') // dá para conectar de novo
    expect(m.socks).toHaveLength(2)
  })

  it('assinar recebe a visão atual e as mudanças da própria conta; cancelar para de receber', async () => {
    const m = montar()
    const a = vi.fn()
    const b = vi.fn()
    const cancelarA = m.sessoes.assinar('a', a)
    m.sessoes.assinar('b', b)
    expect(a).toHaveBeenCalledWith({ estado: 'desconectado' })
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    expect(a).toHaveBeenLastCalledWith({ estado: 'aguardando_qr', qr: 'QR1' })
    expect(b).toHaveBeenCalledTimes(1) // só a chamada inicial: eventos de 'a' não vazam para 'b'
    cancelarA()
    m.socks[0].emitir('connection.update', { connection: 'open' })
    expect(a).toHaveBeenCalledTimes(3)
  })

  it('reabrir abre as contas uma a uma, com intervalo entre elas', async () => {
    const dormir = vi.fn(async (_ms: number) => {})
    const m = montar({ dormir })
    await m.sessoes.reabrir(['a', 'b'], 3000)
    expect(m.socks).toHaveLength(2)
    expect(dormir).toHaveBeenCalledWith(3000)
  })

  it('encerrar fecha todos os sockets sem reconectar', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m, 'a', 0)
    await m.sessoes.iniciar('b')
    await m.sessoes.encerrar()
    expect(m.socks[0].end).toHaveBeenCalled()
    expect(m.socks[1].end).toHaveBeenCalled()
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(500) })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/sessoes.test.ts`
Expected: FAIL (`Cannot find module '../src/sessoes'`).

- [ ] **Step 3: Implementar**

`src/sessoes.ts`:

```ts
import { DisconnectReason, jidNormalizedUser, normalizeMessageContent, type AuthenticationState, type WAMessage } from '@whiskeysockets/baileys'
import { atrasoReconexao } from './backoff'
import { BOAS_VINDAS, recuperados } from './presentation'
import type { Mensagem, Resposta } from './service'

export type Estado = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado'
export type Aviso = 'qr_expirado' | 'sessao_encerrada' | 'sessao_assumida' | 'servidor_lotado' | 'erro'
export type Visao = { estado: Estado; qr?: string; codigo?: string; aviso?: Aviso }

// só o que usamos do WASocket; o adaptador real (src/baileys.ts) e o socket falso dos testes cumprem isto
export type SocketMin = {
  ev: { on(evento: string, ouvinte: (dados: any) => void): void }
  user?: { id: string }
  sendMessage(jid: string, conteudo: { text: string }): Promise<{ key: { id?: string | null } } | undefined>
  groupFetchAllParticipating(): Promise<Record<string, { id: string; subject: string }>>
  requestPairingCode(telefone: string): Promise<string>
  logout(): Promise<void>
  end(erro: Error | undefined): void
}
export type Auth = { state: AuthenticationState; saveCreds: () => Promise<unknown> }
export type ServicoDaConta = { handle(msg: Mensagem, opcoes: { recuperada?: boolean }): Promise<Resposta | null> }

export type DepsSessoes = {
  criarAuth: (contaId: string) => Promise<Auth>
  apagarAuth: (contaId: string) => Promise<void>
  criarSocket: (auth: Auth) => Promise<SocketMin>
  criarService: (contaId: string) => ServicoDaConta
  grupoDa: (contaId: string) => Promise<string | undefined>
  salvarGrupo: (contaId: string, grupoId: string, grupoNome: string) => Promise<void>
  marcarConectada: (contaId: string, conectada: boolean) => Promise<void>
  maxSessoes?: number // padrão 20
  qrMaxMs?: number // padrão 120 000
  dormir?: (ms: number) => Promise<void>
  agora?: () => number // ms
}

type Grupo = { id: string; nome: string }
type Sessao = {
  contaId: string
  estado: Estado
  qr?: string
  codigo?: string
  aviso?: Aviso
  sock?: SocketMin // undefined = nenhum socket "atual"; eventos de sockets antigos são ignorados
  service: ServicoDaConta
  grupoId?: string
  tentativa: number
  encerrada: boolean // desconectar()/encerrar(): nunca reconectar
  conectouEm: number // segundos, mesma unidade de messageTimestamp
  recuperados: number
  fila: Promise<void> // uma mensagem por vez, na ordem em que chegam
  enviados: Set<string> // anti-loop: IDs das mensagens que o próprio bot mandou
  cacheGrupos?: { em: number; lista: Grupo[] }
  timerQr?: ReturnType<typeof setTimeout>
  timerReconexao?: ReturnType<typeof setTimeout>
  timerResumo?: ReturnType<typeof setTimeout>
  ouvintes: Set<(v: Visao) => void>
}

const CACHE_GRUPOS_MS = 60_000

export function criarSessoes(deps: DepsSessoes) {
  const max = deps.maxSessoes ?? 20
  const qrMaxMs = deps.qrMaxMs ?? 120_000
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const agora = deps.agora ?? Date.now
  const sessoes = new Map<string, Sessao>()

  const log = (s: Sessao, onde: string, err: unknown) => console.error(`[conta ${s.contaId}] ${onde}:`, err instanceof Error ? err.message : err)

  function sessaoDe(contaId: string): Sessao {
    let s = sessoes.get(contaId)
    if (!s) {
      s = { contaId, estado: 'desconectado', service: deps.criarService(contaId), tentativa: 0, encerrada: false, conectouEm: 0, recuperados: 0, fila: Promise.resolve(), enviados: new Set(), ouvintes: new Set() }
      sessoes.set(contaId, s)
    }
    return s
  }

  const visaoDe = (s: Sessao): Visao => {
    const v: Visao = { estado: s.estado }
    if (s.qr) v.qr = s.qr
    if (s.codigo) v.codigo = s.codigo
    if (s.aviso) v.aviso = s.aviso
    return v
  }

  function mudar(s: Sessao, parcial: Partial<Pick<Sessao, 'estado' | 'qr' | 'codigo' | 'aviso'>>) {
    Object.assign(s, parcial)
    for (const f of s.ouvintes) {
      try {
        f(visaoDe(s))
      } catch (err) {
        log(s, 'ouvinte', err)
      }
    }
  }

  function limparTimers(s: Sessao) {
    clearTimeout(s.timerQr)
    clearTimeout(s.timerReconexao)
    clearTimeout(s.timerResumo)
    s.timerQr = s.timerReconexao = s.timerResumo = undefined
  }

  // ouvinte de evento do socket: erro de uma conta nunca escapa
  function ouvir(s: Sessao, sock: SocketMin, evento: string, fn: (dados: any) => unknown) {
    sock.ev.on(evento, (dados) => {
      try {
        const r = fn(dados)
        if (r instanceof Promise) r.catch((err) => log(s, evento, err))
      } catch (err) {
        log(s, evento, err)
      }
    })
  }

  async function abrir(s: Sessao) {
    try {
      const auth = await deps.criarAuth(s.contaId)
      if (s.encerrada) return
      const sock = await deps.criarSocket(auth)
      s.sock = sock
      ouvir(s, sock, 'creds.update', () => auth.saveCreds())
      ouvir(s, sock, 'connection.update', (u) => aoAtualizar(s, sock, u))
      ouvir(s, sock, 'messages.upsert', ({ messages, type }: { messages: WAMessage[]; type: string }) => {
        // 'append' = mensagens que chegaram offline (e ecos dos envios do próprio bot, barrados por `enviados`)
        if (type !== 'notify' && type !== 'append') return
        for (const m of messages) s.fila = s.fila.then(() => tratar(s, m))
      })
    } catch (err) {
      log(s, 'abrir', err)
      s.sock = undefined
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'erro' })
    }
  }

  function aoAtualizar(s: Sessao, sock: SocketMin, u: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }) {
    if (s.sock !== sock) return // evento de um socket que já não é o atual
    if (u.qr) {
      s.timerQr ??= setTimeout(() => expirarQr(s), qrMaxMs)
      mudar(s, { estado: 'aguardando_qr', qr: u.qr })
    }
    if (u.connection === 'open') {
      clearTimeout(s.timerQr)
      s.timerQr = undefined
      s.tentativa = 0
      s.conectouEm = Math.floor(agora() / 1000)
      mudar(s, { estado: 'conectado', qr: undefined, codigo: undefined, aviso: undefined })
      deps.marcarConectada(s.contaId, true).catch((err) => log(s, 'marcarConectada', err))
    }
    if (u.connection === 'close' && !s.encerrada) {
      const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      aoFechar(s, codigo)
    }
  }

  function aoFechar(s: Sessao, codigo?: number) {
    clearTimeout(s.timerQr)
    s.timerQr = undefined
    const eraQr = s.estado === 'aguardando_qr'
    s.sock = undefined
    if (codigo === DisconnectReason.loggedOut) {
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'sessao_encerrada' })
      Promise.all([deps.apagarAuth(s.contaId), deps.marcarConectada(s.contaId, false)]).catch((err) => log(s, 'loggedOut', err))
      return
    }
    if (codigo === DisconnectReason.connectionReplaced) {
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'sessao_assumida' })
      deps.marcarConectada(s.contaId, false).catch((err) => log(s, 'replaced', err))
      return
    }
    if (codigo === DisconnectReason.restartRequired) {
      // depois de escanear o QR o WhatsApp exige reiniciar a conexão: faz parte do pareamento
      mudar(s, { estado: 'conectando', qr: undefined })
      void abrir(s)
      return
    }
    if (codigo === DisconnectReason.timedOut && eraQr) {
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'qr_expirado' })
      return
    }
    mudar(s, { estado: 'conectando', qr: undefined })
    s.timerReconexao = setTimeout(() => {
      if (!s.encerrada) void abrir(s)
    }, atrasoReconexao(s.tentativa++))
  }

  function expirarQr(s: Sessao) {
    s.timerQr = undefined
    const sock = s.sock
    s.sock = undefined // o "close" que vem do end() será ignorado
    sock?.end(undefined)
    mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'qr_expirado' })
  }

  async function enviar(s: Sessao, texto: string) {
    const sock = s.sock
    if (!sock || !s.grupoId) return
    await dormir(500 + Math.random() * 1000) // pequeno atraso, menos robótico
    const r = await sock.sendMessage(s.grupoId, { text: texto })
    if (r?.key.id) s.enviados.add(r.key.id)
  }

  function agendarResumo(s: Sessao) {
    clearTimeout(s.timerResumo)
    s.timerResumo = setTimeout(() => {
      const n = s.recuperados
      s.recuperados = 0
      enviar(s, recuperados(n)).catch((err) => log(s, 'resumo', err))
    }, 5000)
  }

  async function tratar(s: Sessao, m: WAMessage) {
    try {
      const id = m.key.id
      if (!id || !s.grupoId || m.key.remoteJid !== s.grupoId || s.enviados.has(id)) return
      const conteudo = normalizeMessageContent(m.message) // desembrulha mensagens temporárias / visualização única
      const texto = conteudo?.conversation ?? conteudo?.extendedTextMessage?.text
      if (!texto) return

      const ts = Number(m.messageTimestamp) || 0
      const enviadoEm = new Date((ts || agora() / 1000) * 1000)
      const remetente = m.key.fromMe ? jidNormalizedUser(s.sock?.user?.id ?? '') : (m.key.participant ?? '')
      // enviada antes de reconectar = chegou enquanto o bot estava offline
      const recuperada = ts > 0 && ts < s.conectouEm - 2

      const r = await s.service.handle({ msgId: id, remetente, texto, enviadoEm }, { recuperada })
      if (!r) return
      if (recuperada && r.lancou) {
        s.recuperados++
        agendarResumo(s)
        return
      }
      await enviar(s, r.texto)
    } catch (err) {
      log(s, 'mensagem', err)
    }
  }

  async function listarGrupos(s: Sessao): Promise<Grupo[]> {
    if (s.estado !== 'conectado' || !s.sock) return []
    if (s.cacheGrupos && agora() - s.cacheGrupos.em < CACHE_GRUPOS_MS) return s.cacheGrupos.lista
    const todos = await s.sock.groupFetchAllParticipating()
    const lista = Object.values(todos)
      .map((g) => ({ id: g.id, nome: g.subject }))
      .sort((a, b) => a.nome.localeCompare(b.nome))
    s.cacheGrupos = { em: agora(), lista }
    return lista
  }

  return {
    async iniciar(contaId: string): Promise<void> {
      const s = sessaoDe(contaId)
      if (s.estado !== 'desconectado') return // clique duplo / duas abas: reaproveita a sessão
      const ativas = [...sessoes.values()].filter((x) => x.estado !== 'desconectado').length
      if (ativas >= max) {
        mudar(s, { aviso: 'servidor_lotado' })
        return
      }
      s.encerrada = false
      s.tentativa = 0
      mudar(s, { estado: 'conectando', qr: undefined, codigo: undefined, aviso: undefined }) // síncrono: fecha a porta para o clique duplo
      s.grupoId = await deps.grupoDa(contaId).catch(() => undefined)
      await abrir(s)
    },

    visao: (contaId: string): Visao => visaoDe(sessaoDe(contaId)),

    assinar(contaId: string, cb: (v: Visao) => void): () => void {
      const s = sessaoDe(contaId)
      s.ouvintes.add(cb)
      cb(visaoDe(s))
      return () => {
        s.ouvintes.delete(cb)
      }
    },

    grupos: (contaId: string): Promise<Grupo[]> => listarGrupos(sessaoDe(contaId)),

    async definirGrupo(contaId: string, grupoId: string): Promise<void> {
      const s = sessaoDe(contaId)
      if (s.estado !== 'conectado' || !s.sock) throw new Error('nao_conectado')
      const g = (await listarGrupos(s)).find((x) => x.id === grupoId)
      if (!g) throw new Error('grupo_invalido') // só vale grupo que está na lista da própria conta
      await deps.salvarGrupo(contaId, g.id, g.nome)
      s.grupoId = g.id
      await enviar(s, BOAS_VINDAS)
    },

    async parear(contaId: string, telefone: string): Promise<string> {
      const s = sessaoDe(contaId)
      const digitos = telefone.replace(/\D/g, '')
      if (digitos.length < 10 || digitos.length > 15) throw new Error('telefone_invalido')
      if (s.estado !== 'aguardando_qr' || !s.sock) throw new Error('indisponivel')
      const codigo = await s.sock.requestPairingCode(digitos)
      mudar(s, { codigo })
      return codigo
    },

    async desconectar(contaId: string): Promise<void> {
      const s = sessaoDe(contaId)
      s.encerrada = true
      limparTimers(s)
      const sock = s.sock
      s.sock = undefined
      if (sock) {
        await sock.logout().catch(() => {}) // sem sessão aberta o logout falha; tudo bem
        try {
          sock.end(undefined)
        } catch {}
      }
      await Promise.all([deps.apagarAuth(contaId), deps.marcarConectada(contaId, false)])
      s.cacheGrupos = undefined
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: undefined })
    },

    // reinício do servidor: uma conta a cada `intervaloMs`, para não abrir todas as conexões de uma vez
    async reabrir(contaIds: string[], intervaloMs = 3000): Promise<void> {
      for (const id of contaIds) {
        await this.iniciar(id).catch((err) => console.error(`[conta ${id}] reabrir:`, err instanceof Error ? err.message : err))
        await dormir(intervaloMs)
      }
    },

    async encerrar(): Promise<void> {
      const filas: Promise<void>[] = []
      for (const s of sessoes.values()) {
        s.encerrada = true
        limparTimers(s)
        filas.push(s.fila)
      }
      await Promise.race([Promise.all(filas), dormir(5000)]) // deixa as mensagens em andamento terminarem (com prazo)
      for (const s of sessoes.values()) {
        const sock = s.sock
        s.sock = undefined
        try {
          sock?.end(undefined)
        } catch {}
      }
    },
  }
}

export type Sessoes = ReturnType<typeof criarSessoes>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/sessoes.test.ts && npm run typecheck`
Expected: PASS, typecheck limpo. Se um teste com relógio falso ficar pendurado, confira que não há `vi.waitFor` dentro de teste que usa `vi.useFakeTimers()`.

- [ ] **Step 5: Commit**

```bash
git add src/sessoes.ts tests/sessoes.test.ts
git commit -m "feat: gerenciador de sessões do WhatsApp (uma por conta, QR, pareamento, estados e falhas isoladas)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Portal web (páginas, rotas, SSE)

**Files:**
- Modify: `package.json` (dependências)
- Create: `src/paginas.ts`, `src/web.ts`
- Test: `tests/web.test.ts`

**Interfaces:**
- Consumes: `Contas`, `Conta`, `ErroCadastro`, `criarLimitador` (Task 3); `Sessoes`, `Visao`, `Aviso` (Task 5).
- Produces: `criarWeb(op: { contas: Contas; sessoes: Sessoes; limitador?: ReturnType<typeof criarLimitador>; cookieSeguro?: boolean; confiarProxy?: boolean }): http.Server` (não chama `listen`).
- `src/paginas.ts` exporta: `esc`, `paginaEntrar(erro?)`, `paginaCadastro(erro?)`, `paginaPainel(email, fragmentoHtml, passo, erro?)`, `fragmentoPainel({ visao, conta, grupos, qrSvg })`, `passoDe(visao, conta)`, `ERROS_PAINEL`, `SCRIPT_PAINEL`.

- [ ] **Step 1: Instalar a dependência**

Run: `npm install qrcode && npm install -D @types/qrcode`
Expected: `package.json` ganha `qrcode` em `dependencies` e `@types/qrcode` em `devDependencies`.

- [ ] **Step 2: Escrever os testes que falham**

`tests/web.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MongoClient } from 'mongodb'
import { criarContas, criarLimitador, type Contas } from '../src/contas'
import { criarWeb } from '../src/web'
import type { Sessoes, Visao } from '../src/sessoes'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const db = client.db('wcoen_test')

function sessoesFalsas() {
  const visoes = new Map<string, Visao>()
  const f = {
    iniciar: vi.fn(async (_id: string) => {}),
    visao: vi.fn((id: string): Visao => visoes.get(id) ?? { estado: 'desconectado' }),
    assinar: vi.fn((id: string, cb: (v: Visao) => void) => {
      cb(f.visao(id))
      return () => {}
    }),
    grupos: vi.fn(async (_id: string) => [{ id: 'g1@g.us', nome: 'Casa' }]),
    definirGrupo: vi.fn(async (_id: string, _g: string) => {}),
    parear: vi.fn(async (_id: string, _t: string) => 'ABCD1234'),
    desconectar: vi.fn(async (_id: string) => {}),
    definir: (id: string, v: Visao) => visoes.set(id, v),
  }
  return f
}

let contas: Contas
let sessoes: ReturnType<typeof sessoesFalsas>
let server: Server
let base = ''

beforeAll(async () => {
  await db.collection('contas').deleteMany({})
  await db.collection('logins').deleteMany({})
  contas = await criarContas(db, { convite: 'segredo' })
  sessoes = sessoesFalsas()
  server = criarWeb({ contas, sessoes: sessoes as unknown as Sessoes, limitador: criarLimitador(5, 60_000), cookieSeguro: true, confiarProxy: true })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
  await client.close()
})
beforeEach(() => vi.clearAllMocks())

const form = (dados: Record<string, string>) => new URLSearchParams(dados).toString()
// cada POST sai de um "IP" novo (X-Forwarded-For), senão o limitador por IP acumularia falhas entre os testes
let ipSeq = 0
const post = (caminho: string, dados: Record<string, string> = {}, cabecalhos: Record<string, string> = {}) =>
  fetch(base + caminho, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, 'X-Forwarded-For': `192.0.2.${++ipSeq}`, ...cabecalhos },
    body: form(dados),
  })
const get = (caminho: string, cookie?: string) => fetch(base + caminho, { redirect: 'manual', headers: cookie ? { cookie } : {} })

let seq = 0
async function entrar(email = `u${++seq}@x.com`) {
  const r = await post('/cadastro', { email, senha: 'senha-boa-123', convite: 'segredo' })
  expect(r.status).toBe(303)
  const cookie = r.headers.getSetCookie()[0].split(';')[0]
  const conta = (await contas.verificar(email, 'senha-boa-123'))!
  return { cookie, conta }
}

describe('cadastro e login', () => {
  it('cadastro válido redireciona ao painel com cookie HttpOnly, SameSite=Lax e Secure', async () => {
    const r = await post('/cadastro', { email: 'novo@x.com', senha: 'senha-boa-123', convite: 'segredo' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/painel')
    const c = r.headers.getSetCookie()[0]
    expect(c).toMatch(/^sid=/)
    expect(c).toContain('HttpOnly')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Secure')
  })

  it('convite errado: 400 com mensagem, sem cookie', async () => {
    const r = await post('/cadastro', { email: 'a@x.com', senha: 'senha-boa-123', convite: 'errado' })
    expect(r.status).toBe(400)
    expect(await r.text()).toContain('Código de convite inválido')
    expect(r.headers.getSetCookie()).toEqual([])
  })

  it('login certo entra; errado dá 401', async () => {
    await entrar('login@x.com')
    const ok = await post('/entrar', { email: ' LOGIN@x.com ', senha: 'senha-boa-123' })
    expect(ok.status).toBe(303)
    const ruim = await post('/entrar', { email: 'login@x.com', senha: 'errada-errada' })
    expect(ruim.status).toBe(401)
  })

  it('depois de 5 falhas o login é bloqueado (429), mesmo com a senha certa', async () => {
    await entrar('forca@x.com')
    for (let i = 0; i < 5; i++) await post('/entrar', { email: 'forca@x.com', senha: 'errada-errada' })
    expect((await post('/entrar', { email: 'forca@x.com', senha: 'senha-boa-123' })).status).toBe(429)
  })

  it('depois de 5 tentativas de cadastro falhas do mesmo IP, o 6º é bloqueado (429), mesmo com convite certo', async () => {
    const mesmoIp = { 'X-Forwarded-For': '198.51.100.9' }
    for (let i = 0; i < 5; i++) await post('/cadastro', { email: `x${i}@x.com`, senha: 'senha-boa-123', convite: 'errado' }, mesmoIp)
    const r = await post('/cadastro', { email: 'valido@x.com', senha: 'senha-boa-123', convite: 'segredo' }, mesmoIp)
    expect(r.status).toBe(429)
  })

  it('sair encerra o login', async () => {
    const { cookie } = await entrar()
    expect((await post('/sair', {}, { cookie })).status).toBe(303)
    expect((await get('/painel', cookie)).headers.get('location')).toBe('/entrar')
  })
})

describe('proteção', () => {
  it('painel sem login redireciona para /entrar', async () => {
    const r = await get('/painel')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/entrar')
  })

  it('POST sem Origin ou com Origin de outro site é recusado (403), inclusive logado', async () => {
    const { cookie } = await entrar()
    const semOrigem = await fetch(base + '/painel/conectar', { method: 'POST', redirect: 'manual', headers: { cookie } })
    expect(semOrigem.status).toBe(403)
    const outra = await post('/painel/conectar', {}, { cookie, Origin: 'https://evil.example' })
    expect(outra.status).toBe(403)
    expect(sessoes.iniciar).not.toHaveBeenCalled()
  })

  it('cabeçalhos de segurança e sem cache', async () => {
    const r = await get('/entrar')
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
})

describe('painel', () => {
  it('Conectar chama iniciar só com a conta do cookie', async () => {
    const { cookie, conta } = await entrar()
    const r = await post('/painel/conectar', {}, { cookie })
    expect(r.status).toBe(303)
    expect(sessoes.iniciar).toHaveBeenCalledWith(conta.id)
  })

  it('e-mail com HTML sai escapado no painel', async () => {
    const { cookie } = await entrar('<b>@x.com')
    const html = await (await get('/painel', cookie)).text()
    expect(html).toContain('&lt;b&gt;@x.com')
    expect(html).not.toContain('<b>@x.com')
  })

  it('nome de grupo com <script> sai escapado', async () => {
    const { cookie, conta } = await entrar()
    sessoes.definir(conta.id, { estado: 'conectado' })
    sessoes.grupos.mockResolvedValueOnce([{ id: 'g9@g.us', nome: '<script>alert(1)</script>' }])
    const html = await (await get('/painel', cookie)).text()
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)')
  })

  it('escolher grupo: chama definirGrupo; id forjado volta ao painel com aviso', async () => {
    const { cookie, conta } = await entrar()
    const ok = await post('/painel/grupo', { grupo: 'g1@g.us' }, { cookie })
    expect(ok.headers.get('location')).toBe('/painel')
    expect(sessoes.definirGrupo).toHaveBeenCalledWith(conta.id, 'g1@g.us')
    sessoes.definirGrupo.mockRejectedValueOnce(new Error('grupo_invalido'))
    const ruim = await post('/painel/grupo', { grupo: 'invasor@g.us' }, { cookie })
    expect(ruim.headers.get('location')).toBe('/painel?erro=grupo')
    expect(await (await get('/painel?erro=grupo', cookie)).text()).toContain('Grupo inválido')
  })

  it('o parâmetro erro não é refletido: valor desconhecido não aparece na página', async () => {
    const { cookie } = await entrar()
    const html = await (await get('/painel?erro=%3Cscript%3E', cookie)).text()
    expect(html).not.toContain('<script>')
  })

  it('parear: mostra o erro de telefone inválido', async () => {
    const { cookie } = await entrar()
    sessoes.parear.mockRejectedValueOnce(new Error('telefone_invalido'))
    const r = await post('/painel/parear', { telefone: '123' }, { cookie })
    expect(r.headers.get('location')).toBe('/painel?erro=telefone')
  })

  it('desconectar chama a sessão da conta', async () => {
    const { cookie, conta } = await entrar()
    await post('/painel/desconectar', {}, { cookie })
    expect(sessoes.desconectar).toHaveBeenCalledWith(conta.id)
  })
})

describe('SSE', () => {
  it('sem login: 401', async () => {
    expect((await get('/painel/eventos')).status).toBe(401)
  })

  it('entrega o QR como SVG e assina só a conta do cookie (nunca a de outra)', async () => {
    const a = await entrar()
    const b = await entrar()
    sessoes.definir(a.conta.id, { estado: 'aguardando_qr', qr: 'QR-DA-A' })
    sessoes.definir(b.conta.id, { estado: 'aguardando_qr', qr: 'QR-DA-B' })
    const ctl = new AbortController()
    const r = await fetch(base + '/painel/eventos', { headers: { cookie: a.cookie }, signal: ctl.signal })
    expect(r.headers.get('content-type')).toContain('text/event-stream')
    const leitor = r.body!.getReader()
    const { value } = await leitor.read()
    await leitor.cancel().catch(() => {})
    ctl.abort()
    const evento = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, '').trim())
    expect(evento.passo).toBe('aguardando_qr')
    expect(evento.html).toContain('<svg')
    expect(sessoes.assinar).toHaveBeenCalledTimes(1)
    expect(sessoes.assinar.mock.calls[0][0]).toBe(a.conta.id)
  })
})

describe('estáticos', () => {
  it('/painel.js é servido como JavaScript e rota desconhecida dá 404', async () => {
    const js = await get('/painel.js')
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(await js.text()).toContain('EventSource')
    expect((await get('/nao-existe')).status).toBe(404)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/web.test.ts`
Expected: FAIL (`Cannot find module '../src/web'`).

- [ ] **Step 4: Implementar `src/paginas.ts`**

```ts
import type { Conta } from './contas'
import type { Aviso, Visao } from './sessoes'

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTIDADES[c])

const ESTILO = `
:root{color-scheme:light dark;--fundo:#f6f7f9;--cartao:#fff;--texto:#1d2330;--suave:#667085;--borda:#e2e5ea;--marca:#128c5a;--erro:#b42318}
@media (prefers-color-scheme:dark){:root{--fundo:#12151b;--cartao:#1b202a;--texto:#eef0f4;--suave:#98a2b3;--borda:#2a303c;--marca:#2bb673;--erro:#f97066}}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.5 system-ui,sans-serif}
main{max-width:440px;margin:0 auto;padding:24px 16px}
h1{margin:8px 0 0;font-size:1.6rem}h2{font-size:1.15rem;margin:0 0 8px}
.sub{color:var(--suave);font-size:.92rem}.erro{color:var(--erro);font-weight:600}
.cartao{background:var(--cartao);border:1px solid var(--borda);border-radius:14px;padding:20px;margin:16px 0}
label{display:block;margin:12px 0;font-size:.9rem;color:var(--suave)}
input,select{display:block;width:100%;margin-top:4px;padding:12px;border:1px solid var(--borda);border-radius:10px;background:var(--fundo);color:var(--texto);font:inherit}
button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:var(--marca);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.sec{background:transparent;color:var(--suave);border:1px solid var(--borda)}
.qr{background:#fff;border-radius:12px;padding:8px;margin:12px auto;max-width:280px}.qr svg{display:block;width:100%;height:auto}
.codigo{font:700 2rem/1.2 ui-monospace,monospace;text-align:center;letter-spacing:.15em;margin:12px 0}
code{background:var(--fundo);padding:1px 6px;border-radius:6px}ul{padding-left:1.1rem}
details{margin-top:12px}summary{cursor:pointer;color:var(--suave)}
.topo{display:flex;justify-content:space-between;align-items:center;gap:8px}.topo form{margin:0}.topo button{width:auto;margin:0;padding:6px 12px}
`

const layout = (titulo: string, corpo: string, script = '') =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body><main>${corpo}</main>${script}</body></html>`

const campo = (nome: string, rotulo: string, tipo = 'text', extra = '') => `<label>${rotulo}<input name="${nome}" type="${tipo}" required ${extra}></label>`
const erroHtml = (erro?: string) => (erro ? `<p class="erro">${esc(erro)}</p>` : '')

export const paginaEntrar = (erro?: string) =>
  layout('Entrar', `<h1>WCOEN</h1><p class="sub">Seu controle financeiro pelo WhatsApp</p><div class="cartao">${erroHtml(erro)}<form method="post" action="/entrar">${campo('email', 'E-mail', 'email', 'autocomplete="username"')}${campo('senha', 'Senha', 'password', 'autocomplete="current-password"')}<button>Entrar</button></form></div><p class="sub">Ainda não tem conta? <a href="/cadastro">Cadastre-se</a></p>`)

export const paginaCadastro = (erro?: string) =>
  layout('Cadastro', `<h1>Criar conta</h1><p class="sub">Você precisa de um código de convite.</p><div class="cartao">${erroHtml(erro)}<form method="post" action="/cadastro">${campo('email', 'E-mail', 'email', 'autocomplete="username"')}${campo('senha', 'Senha (mínimo 8 caracteres)', 'password', 'minlength="8" autocomplete="new-password"')}${campo('convite', 'Código de convite')}<button>Criar conta</button></form></div><p class="sub">Já tem conta? <a href="/entrar">Entrar</a></p>`)

export const ERROS_PAINEL: Record<string, string> = {
  telefone: 'Número inválido. Use DDI e DDD, por exemplo 5511999999999.',
  grupo: 'Grupo inválido. Escolha um da lista.',
}

export const SCRIPT_PAINEL = `const alvo = document.getElementById('estado')
let passo = alvo.dataset.passo
new EventSource('/painel/eventos').onmessage = (e) => {
  const d = JSON.parse(e.data)
  const digitando = alvo.contains(document.activeElement) && document.activeElement !== document.body
  if (d.passo === passo && digitando) return // não apaga o que a pessoa está digitando
  passo = d.passo
  alvo.dataset.passo = d.passo
  alvo.innerHTML = d.html
}
`

export const paginaPainel = (email: string, fragmento: string, passo: string, erro?: string) =>
  layout(
    'Painel',
    `<div class="topo"><h1>WCOEN</h1><form method="post" action="/sair"><button class="sec">Sair</button></form></div><p class="sub">${esc(email)}</p>${erroHtml(erro)}<div class="cartao" id="estado" data-passo="${esc(passo)}">${fragmento}</div>`,
    '<script src="/painel.js"></script>',
  )

const AVISOS: Record<Aviso, string> = {
  qr_expirado: 'O QR expirou. Clique em Conectar para gerar outro.',
  sessao_encerrada: 'A sessão foi encerrada no celular. Conecte de novo.',
  sessao_assumida: 'Outra instância assumiu esta sessão do WhatsApp. Conecte de novo.',
  servidor_lotado: 'Servidor lotado no momento. Tente mais tarde.',
  erro: 'Não foi possível conectar. Tente de novo.',
}

export type DadosFragmento = { visao: Visao; conta: Conta; grupos: { id: string; nome: string }[]; qrSvg?: string }

export const passoDe = (v: Visao, c: Conta) => `${v.estado}${v.estado === 'conectado' && c.grupoId ? ':pronto' : ''}${v.codigo ? ':codigo' : ''}`

const botao = (acao: string, rotulo: string, classe = '') => `<form method="post" action="${acao}"><button class="${classe}">${rotulo}</button></form>`

const seletorGrupo = (grupos: DadosFragmento['grupos'], atual?: string) =>
  grupos.length
    ? `<form method="post" action="/painel/grupo"><label>Grupo do WhatsApp<select name="grupo" required>${grupos.map((g) => `<option value="${esc(g.id)}"${g.id === atual ? ' selected' : ''}>${esc(g.nome)}</option>`).join('')}</select></label><button>Usar este grupo</button></form>`
    : '<p class="sub">Nenhum grupo encontrado. Crie um grupo no WhatsApp e recarregue a página.</p>'

// o que muda ao vivo dentro do painel (renderizado também no SSE)
export function fragmentoPainel({ visao: v, conta, grupos, qrSvg }: DadosFragmento): string {
  if (v.estado === 'desconectado') {
    return `${v.aviso ? `<p class="erro">${AVISOS[v.aviso]}</p>` : ''}<h2>Conecte seu WhatsApp</h2><p class="sub">Você vai vincular este WhatsApp como um aparelho conectado.</p>${botao('/painel/conectar', 'Conectar WhatsApp')}`
  }
  if (v.estado === 'conectando') return '<h2>Conectando…</h2><p class="sub">Aguarde alguns segundos.</p>'
  if (v.estado === 'aguardando_qr') {
    const pareamento = v.codigo
      ? `<p class="sub">No WhatsApp, abra <b>Aparelhos conectados → Conectar com número de telefone</b> e digite:</p><p class="codigo">${esc(`${v.codigo.slice(0, 4)}-${v.codigo.slice(4)}`)}</p>`
      : `<details><summary>Estou no celular: usar código em vez do QR</summary><form method="post" action="/painel/parear">${campo('telefone', 'Seu número com DDI e DDD', 'tel', 'placeholder="5511999999999" inputmode="numeric"')}<button class="sec">Gerar código</button></form></details>`
    return `<h2>Escaneie o QR</h2><p class="sub">No WhatsApp: <b>Aparelhos conectados → Conectar um aparelho</b>.</p><div class="qr">${qrSvg ?? ''}</div>${pareamento}`
  }
  // conectado
  if (!conta.grupoId) return `<h2>Escolha o grupo</h2><p class="sub">O bot vai ler e responder só nesse grupo.</p>${seletorGrupo(grupos)}${botao('/painel/desconectar', 'Desconectar', 'sec')}`
  return `<h2>Tudo pronto ✅</h2><p>Grupo: <strong>${esc(conta.grupoNome ?? conta.grupoId)}</strong></p><p class="sub">Digite no grupo:</p><ul><li><code>mercado 45,90</code> lança uma despesa</li><li><code>+ 70 plantão</code> lança uma receita</li><li><code>balancete</code>, <code>extrato</code>, <code>desfazer</code></li><li><code>ajuda</code> mostra tudo</li></ul><details><summary>Trocar grupo</summary>${seletorGrupo(grupos, conta.grupoId)}</details>${botao('/painel/desconectar', 'Desconectar', 'sec')}`
}
```

- [ ] **Step 5: Implementar `src/web.ts`**

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import QRCode from 'qrcode'
import { criarLimitador, type Conta, type Contas, type ErroCadastro } from './contas'
import { ERROS_PAINEL, SCRIPT_PAINEL, fragmentoPainel, paginaCadastro, paginaEntrar, paginaPainel, passoDe } from './paginas'
import type { Sessoes } from './sessoes'

export type OpcoesWeb = {
  contas: Contas
  sessoes: Sessoes
  limitador?: ReturnType<typeof criarLimitador>
  cookieSeguro?: boolean // com HTTPS (DOMINIO definido)
  confiarProxy?: boolean // lê o IP de X-Forwarded-For (atrás do Caddy)
}

const CABECALHOS = {
  'Content-Security-Policy': "default-src 'self'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
}
const MSG_CADASTRO: Record<ErroCadastro, string> = {
  convite_invalido: 'Código de convite inválido.',
  email_invalido: 'E-mail inválido.',
  senha_curta: 'A senha precisa ter ao menos 8 caracteres.',
  email_em_uso: 'Este e-mail já está cadastrado.',
}
const TRINTA_DIAS_S = 30 * 24 * 3600

class HttpErro extends Error {
  constructor(readonly status: number) {
    super(String(status))
  }
}

async function corpoForm(req: IncomingMessage): Promise<URLSearchParams> {
  const partes: Buffer[] = []
  let total = 0
  for await (const p of req) {
    total += (p as Buffer).length
    if (total > 10_000) throw new HttpErro(413)
    partes.push(p as Buffer)
  }
  return new URLSearchParams(Buffer.concat(partes).toString('utf8'))
}

// só aceita POST vindo do próprio site: Origin presente e com o mesmo host da requisição
function origemOk(req: IncomingMessage): boolean {
  const o = req.headers.origin
  if (!o) return false
  try {
    return new URL(o).host === req.headers.host
  } catch {
    return false
  }
}

export function criarWeb(op: OpcoesWeb): Server {
  const { contas, sessoes } = op
  const limitador = op.limitador ?? criarLimitador(5, 15 * 60_000)

  const html = (res: ServerResponse, status: number, corpo: string) => {
    res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'text/html; charset=utf-8' })
    res.end(corpo)
  }
  const ir = (res: ServerResponse, para: string, cookie?: string) => {
    res.writeHead(303, { ...CABECALHOS, Location: para, ...(cookie ? { 'Set-Cookie': cookie } : {}) })
    res.end()
  }
  const cookieSessao = (token: string, maxAge: number) => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${op.cookieSeguro ? '; Secure' : ''}`
  const tokenDe = (req: IncomingMessage) => /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1]
  const contaDe = async (req: IncomingMessage): Promise<Conta | null> => {
    const t = tokenDe(req)
    return t ? contas.contaDoLogin(t) : null
  }
  const ipDe = (req: IncomingMessage) => (op.confiarProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?'

  async function montarFragmento(contaId: string) {
    const conta = await contas.porId(contaId)
    if (!conta) return null
    const visao = sessoes.visao(contaId)
    const grupos = visao.estado === 'conectado' ? await sessoes.grupos(contaId).catch(() => []) : []
    const qrSvg = visao.qr ? await QRCode.toString(visao.qr, { type: 'svg', margin: 1 }) : undefined
    return { passo: passoDe(visao, conta), html: fragmentoPainel({ visao, conta, grupos, qrSvg }) }
  }

  async function tratar(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x')
    const caminho = url.pathname
    const metodo = req.method ?? 'GET'
    if (metodo === 'POST' && !origemOk(req)) throw new HttpErro(403)
    const conta = await contaDe(req)

    if (metodo === 'GET') {
      if (caminho === '/') return ir(res, '/painel')
      if (caminho === '/entrar' || caminho === '/cadastro') {
        if (conta) return ir(res, '/painel')
        return html(res, 200, caminho === '/entrar' ? paginaEntrar() : paginaCadastro())
      }
      if (caminho === '/painel.js') {
        res.writeHead(200, { ...CABECALHOS, 'Content-Type': 'text/javascript; charset=utf-8' })
        return void res.end(SCRIPT_PAINEL)
      }
      if (caminho === '/painel') {
        if (!conta) return ir(res, '/entrar')
        const f = (await montarFragmento(conta.id))!
        const chave = url.searchParams.get('erro') ?? ''
        return html(res, 200, paginaPainel(conta.email, f.html, f.passo, Object.hasOwn(ERROS_PAINEL, chave) ? ERROS_PAINEL[chave] : undefined))
      }
      if (caminho === '/painel/eventos') {
        if (!conta) throw new HttpErro(401)
        res.writeHead(200, { ...CABECALHOS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
        let fila: Promise<unknown> = Promise.resolve()
        const enviar = () => {
          fila = fila
            .then(async () => {
              const f = await montarFragmento(conta.id)
              if (f && !res.writableEnded) res.write(`data: ${JSON.stringify(f)}\n\n`) // JSON não tem quebra de linha crua
            })
            .catch((err) => console.error('sse:', err instanceof Error ? err.message : err))
        }
        const cancelar = sessoes.assinar(conta.id, enviar) // sempre a conta do cookie
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
        req.on('close', () => {
          clearInterval(ping)
          cancelar()
        })
        return
      }
      throw new HttpErro(404)
    }

    if (metodo !== 'POST') throw new HttpErro(405)
    const f = await corpoForm(req)

    if (caminho === '/entrar') {
      const email = (f.get('email') ?? '').trim().toLowerCase()
      const chaves = [`e:${email}`, `i:${ipDe(req)}`]
      if (chaves.some((k) => limitador.bloqueado(k))) return html(res, 429, paginaEntrar('Muitas tentativas. Aguarde alguns minutos.'))
      const c = await contas.verificar(email, f.get('senha') ?? '')
      if (!c) {
        chaves.forEach((k) => limitador.falhou(k))
        return html(res, 401, paginaEntrar('E-mail ou senha incorretos.'))
      }
      limitador.limpar(chaves[0])
      return ir(res, '/painel', cookieSessao(await contas.criarLogin(c.id), TRINTA_DIAS_S))
    }

    if (caminho === '/cadastro') {
      const chaveIp = `i:${ipDe(req)}`
      if (limitador.bloqueado(chaveIp)) return html(res, 429, paginaCadastro('Muitas tentativas. Aguarde alguns minutos.'))
      const r = await contas.cadastrar(f.get('email') ?? '', f.get('senha') ?? '', f.get('convite') ?? '')
      if (!r.ok) {
        limitador.falhou(chaveIp)
        return html(res, 400, paginaCadastro(MSG_CADASTRO[r.erro]))
      }
      return ir(res, '/painel', cookieSessao(await contas.criarLogin(r.conta.id), TRINTA_DIAS_S))
    }

    if (caminho === '/sair') {
      const t = tokenDe(req)
      if (t) await contas.encerrarLogin(t)
      return ir(res, '/entrar', cookieSessao('', 0))
    }

    if (!conta) return ir(res, '/entrar')

    if (caminho === '/painel/conectar') {
      await sessoes.iniciar(conta.id)
      return ir(res, '/painel')
    }
    if (caminho === '/painel/parear') {
      try {
        await sessoes.parear(conta.id, f.get('telefone') ?? '')
      } catch (err) {
        if ((err as Error).message === 'telefone_invalido') return ir(res, '/painel?erro=telefone')
        if ((err as Error).message !== 'indisponivel') throw err
      }
      return ir(res, '/painel')
    }
    if (caminho === '/painel/grupo') {
      try {
        await sessoes.definirGrupo(conta.id, f.get('grupo') ?? '')
      } catch (err) {
        if ((err as Error).message === 'grupo_invalido') return ir(res, '/painel?erro=grupo')
        if ((err as Error).message !== 'nao_conectado') throw err
      }
      return ir(res, '/painel')
    }
    if (caminho === '/painel/desconectar') {
      await sessoes.desconectar(conta.id)
      return ir(res, '/painel')
    }
    throw new HttpErro(404)
  }

  return createServer((req, res) => {
    tratar(req, res).catch((err) => {
      const status = err instanceof HttpErro ? err.status : 500
      if (status === 500) console.error('web:', err instanceof Error ? err.message : err)
      if (res.headersSent) return void res.end()
      res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(status === 500 ? 'Erro interno' : String(status))
    })
  })
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/web.test.ts && npm run typecheck`
Expected: PASS, typecheck limpo. Erros de tipo em `paginas.ts` (import de `Aviso`) indicam que a Task 5 não foi concluída.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/paginas.ts src/web.ts tests/web.test.ts
git commit -m "feat: portal web (cadastro, login, painel com QR ao vivo por SSE, escolha de grupo)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Migração dos dados legados e reset de senha

**Files:**
- Create: `src/migrar.ts`, `src/cli/migrar.ts`, `src/cli/senha.ts`
- Modify: `package.json` (scripts `migrar` e `senha`)
- Test: `tests/migrar.test.ts`

**Interfaces:**
- Consumes: `conectarMongo` (Task 1), `criarContas` (Task 3).
- Produces: `migrarLegado(db: Db, email: string): Promise<number>` (quantidade de lançamentos atribuídos).

- [ ] **Step 1: Escrever o teste que falha**

`tests/migrar.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { migrarLegado } from '../src/migrar'
import { criarContas } from '../src/contas'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const db = client.db('wcoen_test')
const lanc = db.collection('lancamentos')
afterAll(() => client.close())

const doc = (msgId: string, extra: object = {}) => ({ tipo: 'despesa', conta: 'x', valor: 1, remetente: 'u', msgId, data: new Date(), enviadoEm: new Date(), desfeitoEm: null, ...extra })

beforeEach(async () => {
  await db.collection('contas').deleteMany({})
  await lanc.deleteMany({})
})

describe('migrarLegado', () => {
  it('atribui a conta aos lançamentos sem contaId, preserva os de outras contas e é idempotente', async () => {
    const contas = await criarContas(db, { convite: 'c' })
    const r = await contas.cadastrar('dono@x.com', 'senha-boa-123', 'c')
    if (!r.ok) throw new Error('cadastro')
    await lanc.insertMany([doc('1'), doc('2'), doc('3', { contaId: 'outra' })])

    expect(await migrarLegado(db, '  DONO@x.com ')).toBe(2)
    expect(await lanc.countDocuments({ contaId: r.conta.id })).toBe(2)
    expect(await lanc.countDocuments({ contaId: 'outra' })).toBe(1)
    expect(await migrarLegado(db, 'dono@x.com')).toBe(0)
  })

  it('conta inexistente: erro claro e nada é alterado', async () => {
    await lanc.insertOne(doc('1'))
    await expect(migrarLegado(db, 'ninguem@x.com')).rejects.toThrow('conta não encontrada')
    expect(await lanc.countDocuments({ contaId: { $exists: false } })).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/migrar.test.ts`
Expected: FAIL (`Cannot find module '../src/migrar'`).

- [ ] **Step 3: Implementar**

`src/migrar.ts`:

```ts
import type { Db } from 'mongodb'

// Atribui a conta indicada aos lançamentos de antes do portal (sem contaId). Idempotente.
export async function migrarLegado(db: Db, email: string): Promise<number> {
  const conta = await db.collection('contas').findOne({ email: email.trim().toLowerCase() })
  if (!conta) throw new Error(`conta não encontrada: ${email}`)
  const r = await db.collection('lancamentos').updateMany({ contaId: { $exists: false } }, { $set: { contaId: conta._id.toHexString() } })
  return r.modifiedCount
}
```

`src/cli/migrar.ts`:

```ts
import { migrarLegado } from '../migrar'
import { conectarMongo } from '../repo'

const [email] = process.argv.slice(2)
const uri = process.env.MONGO_URI
if (!email || !uri) {
  console.error('Uso: npm run migrar -- <e-mail da conta dona dos lançamentos atuais>  (MONGO_URI vem do .env)')
  process.exit(1)
}
const { db, close } = await conectarMongo(uri, process.env.MONGO_DB || 'wcoen')
try {
  console.log(`${await migrarLegado(db, email)} lançamento(s) atribuído(s) a ${email}`)
} finally {
  await close()
}
```

`src/cli/senha.ts`:

```ts
import { criarContas } from '../contas'
import { conectarMongo } from '../repo'

const [email, senha] = process.argv.slice(2)
const uri = process.env.MONGO_URI
if (!email || !senha || !uri) {
  console.error('Uso: npm run senha -- <e-mail> <nova senha (mín. 8 caracteres)>  (MONGO_URI vem do .env)')
  process.exit(1)
}
const { db, close } = await conectarMongo(uri, process.env.MONGO_DB || 'wcoen')
try {
  const contas = await criarContas(db, { convite: '' })
  console.log((await contas.redefinirSenha(email, senha)) ? 'Senha redefinida; os logins ativos foram encerrados.' : 'Conta não encontrada ou senha curta demais.')
} finally {
  await close()
}
```

Em `package.json`, dentro de `"scripts"`, acrescente:

```json
    "migrar": "node --env-file=.env --import tsx src/cli/migrar.ts",
    "senha": "node --env-file=.env --import tsx src/cli/senha.ts",
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/migrar.test.ts && npm run typecheck`
Expected: PASS, typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/migrar.ts src/cli package.json tests/migrar.test.ts
git commit -m "feat: scripts de migração dos lançamentos legados e de reset de senha" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Configuração, Baileys real e ligação no `index.ts`

**Files:**
- Modify: `src/config.ts`, `tests/config.test.ts`, `src/index.ts`
- Create: `src/baileys.ts`
- Delete: `src/whatsapp.ts`
- Modify: `package.json` (remover `qrcode-terminal` e `@types/qrcode-terminal`)

**Interfaces:**
- Consumes: tudo das Tasks 1–7.
- Produces: `loadConfig(env): Config` com `{ mongoUri, mongoDb, porta: number, dominio?: string, convite: string, chaveCripto: Buffer, maxSessoes: number, openrouter? }` (some `groupId`); `criarSocketBaileys(auth: Auth): Promise<SocketMin>`.

- [ ] **Step 1: Reescrever os testes da config (falham)**

Substitua `tests/config.test.ts` inteiro por:

```ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const CHAVE = 'a'.repeat(64)
const base = { MONGO_URI: 'mongodb://x', CONVITE: 'convite-piloto', CHAVE_CRIPTO: CHAVE }

describe('loadConfig', () => {
  it('lê variáveis e aplica defaults', () => {
    expect(loadConfig(base)).toEqual({
      mongoUri: 'mongodb://x',
      mongoDb: 'wcoen',
      porta: 3000,
      convite: 'convite-piloto',
      chaveCripto: Buffer.from(CHAVE, 'hex'),
      maxSessoes: 20,
    })
  })

  it('respeita MONGO_DB, PORTA, DOMINIO e MAX_SESSOES', () => {
    const c = loadConfig({ ...base, MONGO_DB: 'outro', PORTA: '8080', DOMINIO: 'app.exemplo.com', MAX_SESSOES: '5' })
    expect(c).toMatchObject({ mongoDb: 'outro', porta: 8080, dominio: 'app.exemplo.com', maxSessoes: 5 })
  })

  it('falha sem MONGO_URI', () => {
    expect(() => loadConfig({ ...base, MONGO_URI: undefined })).toThrow('MONGO_URI não definido no .env')
  })

  it('cadastro fechado: exige CONVITE', () => {
    expect(() => loadConfig({ ...base, CONVITE: '' })).toThrow('CONVITE não definido no .env')
  })

  it('exige CHAVE_CRIPTO com 64 caracteres hexadecimais', () => {
    expect(() => loadConfig({ ...base, CHAVE_CRIPTO: undefined })).toThrow('CHAVE_CRIPTO')
    expect(() => loadConfig({ ...base, CHAVE_CRIPTO: 'curta' })).toThrow('CHAVE_CRIPTO')
    expect(() => loadConfig({ ...base, CHAVE_CRIPTO: 'z'.repeat(64) })).toThrow('CHAVE_CRIPTO')
  })

  it('OpenRouter é opcional: sem chave (ou chave vazia) fica desligado', () => {
    expect(loadConfig(base).openrouter).toBeUndefined()
    expect(loadConfig({ ...base, OPENROUTER_API_KEY: '', OPENROUTER_MODEL: '' }).openrouter).toBeUndefined()
  })

  it('lê chave e modelo: só os de OPENROUTER_MODEL, sem reserva gratuita', () => {
    const c = loadConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'um/modelo' })
    expect(c.openrouter).toEqual({ apiKey: 'k', models: ['um/modelo'] })
  })

  it('OPENROUTER_MODEL aceita vários modelos, em ordem', () => {
    const c = loadConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'a/1, b/2' })
    expect(c.openrouter?.models).toEqual(['a/1', 'b/2'])
  })

  it('OPENROUTER_FALLBACK_MODELS é ignorada: nada de modelo fora do OPENROUTER_MODEL', () => {
    const c = loadConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'um/modelo', OPENROUTER_FALLBACK_MODELS: 'x/1:free' })
    expect(c.openrouter?.models).toEqual(['um/modelo'])
  })

  it('exige o modelo quando há chave', () => {
    expect(() => loadConfig({ ...base, OPENROUTER_API_KEY: 'k' })).toThrow('OPENROUTER_MODEL não definido')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `config.ts`**

Substitua `src/config.ts` inteiro por:

```ts
const lista = (v?: string) => (v ?? '').split(',').map((m) => m.trim()).filter(Boolean)

export type Config = {
  mongoUri: string
  mongoDb: string
  porta: number
  dominio?: string // com DOMINIO o portal assume HTTPS atrás do Caddy (cookie Secure, IP do X-Forwarded-For)
  convite: string // código exigido no cadastro (cadastro fechado)
  chaveCripto: Buffer // 32 bytes; criptografa as credenciais do WhatsApp no Mongo
  maxSessoes: number
  openrouter?: { apiKey: string; models: string[] } // opcional: sem chave, a auditoria fica desligada; models (só pagos) em ordem de tentativa
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mongoUri = env.MONGO_URI
  if (!mongoUri) throw new Error('MONGO_URI não definido no .env')
  const convite = env.CONVITE
  if (!convite) throw new Error('CONVITE não definido no .env')
  const chave = env.CHAVE_CRIPTO ?? ''
  if (!/^[0-9a-f]{64}$/i.test(chave)) {
    throw new Error('CHAVE_CRIPTO deve ter 64 caracteres hexadecimais (32 bytes). Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }

  let openrouter: Config['openrouter']
  if (env.OPENROUTER_API_KEY) {
    const models = [...new Set(lista(env.OPENROUTER_MODEL))]
    if (!models.length) throw new Error('OPENROUTER_MODEL não definido no .env (obrigatório com OPENROUTER_API_KEY)')
    openrouter = { apiKey: env.OPENROUTER_API_KEY, models }
  }
  return {
    mongoUri,
    mongoDb: env.MONGO_DB || 'wcoen',
    porta: Number(env.PORTA) || 3000,
    dominio: env.DOMINIO || undefined,
    convite,
    chaveCripto: Buffer.from(chave, 'hex'),
    maxSessoes: Number(env.MAX_SESSOES) || 20,
    openrouter,
  }
}
```

- [ ] **Step 4: Fábrica real do socket**

`src/baileys.ts`:

```ts
import makeWASocket, { fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import type { Auth, SocketMin } from './sessoes'

export async function criarSocketBaileys(auth: Auth): Promise<SocketMin> {
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: auth.state, logger: pino({ level: 'silent' }), markOnlineOnConnect: false })
  return sock as unknown as SocketMin // o WASocket tem estes métodos; o tipo mínimo evita acoplar os testes ao Baileys
}
```

- [ ] **Step 5: Ligar tudo no `index.ts`**

Substitua `src/index.ts` inteiro por:

```ts
import { criarAuditorOpenRouter } from './auditar'
import { apagarAuth, criarAuthState, garantirIndiceAuth, type DocAuth } from './authstate'
import { criarSocketBaileys } from './baileys'
import { loadConfig } from './config'
import { criarContas, criarLimitador } from './contas'
import { conectarMongo } from './repo'
import { Service } from './service'
import { criarSessoes } from './sessoes'
import { criarWeb } from './web'

const config = loadConfig()

let mongo: Awaited<ReturnType<typeof conectarMongo>>
try {
  mongo = await conectarMongo(config.mongoUri, config.mongoDb)
} catch (err) {
  console.error('Não consegui conectar ao Mongo (o container está de pé?):', (err as Error).message)
  process.exit(1)
}

const contas = await criarContas(mongo.db, { convite: config.convite })
const authCol = mongo.db.collection<DocAuth>('wa_auth')
await garantirIndiceAuth(authCol)

// auditor só existe com OPENROUTER_API_KEY + OPENROUTER_MODEL; sem ele, o comando auditoria avisa que a IA está desligada
const auditor = config.openrouter ? criarAuditorOpenRouter(config.openrouter) : undefined

const sessoes = criarSessoes({
  criarAuth: (id) => criarAuthState(authCol, id, config.chaveCripto),
  apagarAuth: (id) => apagarAuth(authCol, id),
  criarSocket: criarSocketBaileys,
  criarService: (id) => new Service(mongo.repoDe(id), undefined, auditor),
  grupoDa: async (id) => (await contas.porId(id))?.grupoId,
  salvarGrupo: (id, grupoId, nome) => contas.definirGrupo(id, grupoId, nome),
  marcarConectada: (id, conectada) => contas.marcarConectada(id, conectada),
  maxSessoes: config.maxSessoes,
})

const web = criarWeb({
  contas,
  sessoes,
  limitador: criarLimitador(5, 15 * 60_000),
  cookieSeguro: Boolean(config.dominio),
  confiarProxy: Boolean(config.dominio),
})
web.listen(config.porta, () => console.log(`Portal em http://localhost:${config.porta}`))

// reabre as sessões que estavam conectadas antes do reinício, escalonadas
void sessoes.reabrir(await contas.conectadas())

let saindo = false
async function sair() {
  if (saindo) process.exit(1) // segundo sinal: sai já
  saindo = true
  web.close()
  web.closeAllConnections()
  await sessoes.encerrar()
  await mongo.close()
  process.exit(0)
}
process.on('SIGINT', sair)
process.on('SIGTERM', sair)
```

- [ ] **Step 6: Remover o adaptador antigo e a dependência de terminal**

Run:
```bash
git rm src/whatsapp.ts
npm uninstall qrcode-terminal @types/qrcode-terminal
```

- [ ] **Step 7: Rodar tudo**

Run: `npm run typecheck && npm test`
Expected: typecheck limpo; todos os testes passam (Mongo do Docker de pé). Nenhum arquivo importa mais `whatsapp`.

- [ ] **Step 8: Fumaça com o servidor de verdade**

Acrescente ao `.env` local (sem apagar o que existe): `CONVITE=convite-local`, `CHAVE_CRIPTO=<64 hex gerado pelo comando acima>`. Pare o bot antigo (senão dois processos respondem no mesmo grupo). Depois:

Run: `npm start` (em segundo plano) e, em outro terminal, `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/entrar`
Expected: `200`. Encerre com `Ctrl+C` e confira que o processo sai limpo.

- [ ] **Step 9: Commit**

```bash
git add src/config.ts tests/config.test.ts src/baileys.ts src/index.ts package.json package-lock.json
git commit -m "feat: liga portal e sessões no index; config nova; remove o adaptador de terminal" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Empacotamento (Docker + HTTPS), documentação e roteiro manual

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.dockerignore`, `docs/roteiro-manual-portal.md`
- Modify: `.env.example`, `README.md`

**Interfaces:**
- Consumes: variáveis de `loadConfig` (Task 8).

- [ ] **Step 1: `Dockerfile`**

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
# sem etapa de build: roda com tsx, como em desenvolvimento (as variáveis vêm do docker-compose)
CMD ["node", "--import", "tsx", "src/index.ts"]
```

- [ ] **Step 2: `.dockerignore`**

```
node_modules
auth
.env
.git
docs
tests
```

- [ ] **Step 3: `docker-compose.yml`**

```yaml
services:
  mongo:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db
    # sem "ports": o banco só é acessível pela rede interna do compose

  app:
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      MONGO_URI: mongodb://mongo:27017
    depends_on:
      - mongo

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMINIO: ${DOMINIO}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - app

volumes:
  mongo-data:
  caddy-data:
  caddy-config:
```

- [ ] **Step 4: `Caddyfile`**

```
{$DOMINIO} {
	encode gzip
	reverse_proxy app:3000 {
		flush_interval -1
	}
}
```

(`flush_interval -1` mantém o SSE do QR fluindo sem buffer.)

- [ ] **Step 5: `.env.example` (substituir inteiro)**

```
# Mongo. No docker-compose o app usa mongodb://mongo:27017 automaticamente; aqui vale para rodar com "npm start".
MONGO_URI=mongodb://localhost:27017
MONGO_DB=wcoen

# Código que o cliente precisa digitar para se cadastrar no portal (cadastro fechado). Entregue só aos pilotos.
CONVITE=
# 64 caracteres hexadecimais; criptografa as credenciais do WhatsApp no banco. NÃO perca nem troque depois
# (sem ela as sessões gravadas ficam ilegíveis). Gere com:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CHAVE_CRIPTO=

# Porta do portal (padrão 3000) e limite de contas conectadas ao mesmo tempo (padrão 20)
PORTA=3000
MAX_SESSOES=20
# Domínio público do portal (ex.: app.seudominio.com.br). Com ele o Caddy emite o HTTPS e o cookie passa a ser Secure.
DOMINIO=

# Opcional: comando "auditoria" (dicas da IA). Sem chave, ele responde que a IA não está configurada.
# ATENÇÃO: a auditoria envia valores, datas e descrições dos lançamentos ao OpenRouter, só para os modelos abaixo.
# Use modelos PAGOS (https://openrouter.ai/models), separados por vírgula: o primeiro é o preferido; se falhar, tenta o próximo.
OPENROUTER_API_KEY=
OPENROUTER_MODEL=
```

- [ ] **Step 6: Roteiro manual `docs/roteiro-manual-portal.md`**

```markdown
# Roteiro manual do portal (WhatsApp real)

O WhatsApp real não é automatizável; rode este roteiro com um número de teste antes de liberar um piloto. **Pare o bot antigo antes** (dois processos no mesmo grupo respondem em dobro).

1. Suba o sistema (`docker compose up -d` ou `npm start`) e abra o portal.
2. **Cadastro:** cadastre-se com o `CONVITE`. Convite errado deve ser recusado.
3. **QR:** clique em *Conectar WhatsApp*; o QR aparece e se renova sozinho. No celular: *Aparelhos conectados → Conectar um aparelho* e escaneie. O painel deve passar para "Escolha o grupo" sem recarregar a página.
4. **Código de pareamento:** desconecte, conecte de novo, use *Estou no celular* com o número e digite o código no WhatsApp.
5. **QR expirado:** conecte e não escaneie por 2 minutos. Deve voltar a "Conecte seu WhatsApp" com o aviso.
6. **Grupo:** escolha um grupo. O grupo deve receber "✅ CONECTADO".
7. **Comandos:** `mercado 45,90`, `+ 70 plantão`, `balancete`, `extrato`, `desfazer`, `ajuda`. Confira o formato das mensagens.
8. **Isolamento:** cadastre uma segunda conta (outro número/grupo) e confirme que os balancetes não se misturam.
9. **Recuperação:** com a conta conectada, mate o servidor, mande um lançamento no grupo, suba de novo. O lançamento entra e chega o aviso "LANÇAMENTOS RECUPERADOS". Nenhuma mensagem "Bot online/desligando" deve aparecer.
10. **Sessão removida no celular:** remova o aparelho em *Aparelhos conectados*. O painel deve mostrar "sessão encerrada" e nada de reconexão em loop.
11. **Migração dos seus dados antigos:** `npm run migrar -- seu@email` e confira o extrato.
12. **Senha:** `npm run senha -- seu@email nova-senha-123` e entre com ela.
```

- [ ] **Step 7: README**

Acrescente ao fim de `README.md`:

```markdown

## Portal (SaaS)

O bot roda como serviço: cada cliente se cadastra no portal, conecta o próprio WhatsApp (QR ou código de pareamento) e escolhe o grupo onde o bot responde. Detalhes em `docs/superpowers/specs/2026-09-26-portal-saas-design.md`.

### Subir em um servidor

1. Copie `.env.example` para `.env` e preencha `CONVITE`, `CHAVE_CRIPTO` e `DOMINIO` (o DNS do domínio deve apontar para o servidor; portas 80 e 443 abertas).
2. `docker compose up -d`. O Caddy emite o HTTPS sozinho; o Mongo não é exposto fora da rede do compose.
3. Acesse `https://SEU_DOMINIO`, cadastre-se com o convite e conecte o WhatsApp.

### Operação

- **Migrar lançamentos de antes do portal:** `npm run migrar -- seu@email` (idempotente).
- **Redefinir senha de um cliente:** `npm run senha -- email@cliente.com nova-senha-123`.
- **Backup do banco:** `docker compose exec -T mongo mongodump --archive --gzip > backup-$(date +%F).gz`. Guarde `CHAVE_CRIPTO` fora do servidor: sem ela, as sessões do WhatsApp gravadas não abrem.
- **Testar antes de liberar um piloto:** `docs/roteiro-manual-portal.md`.
```

- [ ] **Step 8: Validar o empacotamento**

Run: `docker compose config -q && docker compose build app`
Expected: `config` sem erro (com `DOMINIO` definido no `.env`) e a imagem do `app` constrói.

- [ ] **Step 9: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml Caddyfile .env.example README.md docs/roteiro-manual-portal.md
git commit -m "chore: empacotamento (Docker, Caddy/HTTPS), .env.example, README e roteiro manual do portal" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review (feito ao escrever o plano)

**Cobertura da spec**

| Requisito da spec | Task |
|---|---|
| `repoDe(contaId)`, índices `(contaId, msgId)` e `(contaId, data)`, `Repo` intacto | 1 |
| `wa_auth` criptografada (AES-256-GCM), sem credencial em claro | 2 |
| `contas`, `logins` (TTL 30 dias), scrypt, convite, limite de tentativas | 3 |
| Boas-vindas única; fim de "Bot online/desligando" | 4, 5, 8 (o `whatsapp.ts` sai) |
| Estados, QR ~2 min, 515, `loggedOut`, `connectionReplaced`, queda com backoff, `MAX_SESSOES`, erro isolado, reabrir escalonado, sem grupo não processa | 5 |
| Código de pareamento | 5 (lógica) e 6 (tela e rota) |
| Portal: rotas, SSE, painel em 3 passos, cookie, `Origin`, isolamento, escape de HTML | 6 |
| `npm run migrar` (idempotente) e reset de senha | 7 |
| Novas variáveis (`CONVITE`, `CHAVE_CRIPTO`, `DOMINIO`, `PORTA`, `MAX_SESSOES`), fábrica real do Baileys | 8 |
| Dockerfile, compose (app, Mongo com volume, Caddy), backup, roteiro manual | 9 |

**Desvio em relação à spec:** a spec lista `web.ts` como dono das páginas; o plano separa o HTML puro em `src/paginas.ts` só para manter os arquivos pequenos. Também surgiram duas coisas que a spec não nomeava: o cache de 60 s da lista de grupos (o WhatsApp limita `groupFetchAllParticipating`) e a marca `conectada` em `contas`, necessária para saber quais sessões reabrir sem reabrir contas abandonadas na fase do QR. A mensagem "lançamentos recuperados" também passou a viver em `presentation.ts`, coerente com o padrão visual.

**Consistência de tipos:** `Visao`, `Aviso`, `Estado`, `SocketMin`, `Auth`, `DepsSessoes` (Task 5) são os mesmos usados em `paginas.ts`, `web.ts` e `baileys.ts`; `Contas`/`Conta`/`ErroCadastro`/`criarLimitador` (Task 3) idem; `conectarMongo` devolve `{ db, repoDe, close }` em todas as tasks que o usam.

**Riscos que só o teste manual cobre:** o comportamento real do Baileys no pareamento por código (`requestPairingCode` depende do estado do socket) e o 515 após o QR não são reproduzíveis com socket falso; estão no roteiro manual (itens 3–5).
