import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient } from 'mongodb'
import { criarContas, type Contas } from '../src/contas'
import { criarConvites } from '../src/convites'

const URI = process.env.TEST_MONGO_URI ?? 'mongodb://localhost:27017'
const client = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 })
const db = client.db('wcoen_test_contas')
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

describe('convites dinâmicos (criados por um admin), além do código mestre', () => {
  it('cadastro com um convite dinâmico funciona e o consome; o mesmo código não serve duas vezes', async () => {
    const convites = await criarConvites(db)
    const c = await criarContas(db, { convite: 'segredo', convites })
    const { codigo } = await convites.criar('admin1', 'para a Ana')

    const r = await c.cadastrar('ana@x.com', 'senha-boa-123', codigo)
    expect(r.ok).toBe(true)

    const r2 = await c.cadastrar('outra@x.com', 'senha-boa-123', codigo)
    expect(r2).toEqual({ ok: false, erro: 'convite_invalido' })
  })

  it('o código mestre do .env continua funcionando ao lado dos convites dinâmicos', async () => {
    const convites = await criarConvites(db)
    const c = await criarContas(db, { convite: 'segredo', convites })
    expect((await c.cadastrar('ana@x.com', 'senha-boa-123', 'segredo')).ok).toBe(true)
  })

  it('sem "convites" configurado, só o código mestre vale (comportamento anterior)', async () => {
    const c = await criarContas(db, { convite: 'segredo' })
    expect(await c.cadastrar('ana@x.com', 'senha-boa-123', 'um-codigo-qualquer')).toEqual({ ok: false, erro: 'convite_invalido' })
  })

  it('convite dinâmico com e-mail inválido não é consumido: dá pra tentar de novo com o mesmo código', async () => {
    const convites = await criarConvites(db)
    const c = await criarContas(db, { convite: 'segredo', convites })
    const { codigo } = await convites.criar('admin1')

    expect(await c.cadastrar('sem-arroba', 'senha-boa-123', codigo)).toEqual({ ok: false, erro: 'email_invalido' })
    expect(await convites.existe(codigo)).toBe(true)
    expect((await c.cadastrar('ana@x.com', 'senha-boa-123', codigo)).ok).toBe(true)
  })
})
