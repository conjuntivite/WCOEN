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
