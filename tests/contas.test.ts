import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { criarContas, type Contas } from '../src/contas'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen'
const pool = new Pool({ connectionString: URL })
let contas: Contas

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS logins')
  await pool.query('DROP TABLE IF EXISTS contas')
  contas = await criarContas(pool, { convite: 'segredo' })
})
afterAll(() => pool.end())

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
    const semConvite = await criarContas(pool, { convite: '' })
    expect(await semConvite.cadastrar('ana@x.com', 'senha-boa-123', '')).toEqual({ ok: false, erro: 'convite_invalido' })
  })

  it('cadastro concorrente com o mesmo e-mail: só um vence, o outro recebe email_em_uso', async () => {
    const [r1, r2] = await Promise.all([cadastrar('corrida@x.com'), cadastrar('corrida@x.com')])
    const oks = [r1, r2].filter((r) => r.ok)
    const falhas = [r1, r2].filter((r) => !r.ok)
    expect(oks).toHaveLength(1)
    expect(falhas).toEqual([{ ok: false, erro: 'email_em_uso' }])
  })
})

describe('login', () => {
  it('verificar confere e-mail e senha; login e logout funcionam', async () => {
    const { conta } = (await cadastrar()) as { ok: true; conta: { id: string } }
    const token = await contas.criarLogin(conta.id)
    expect((await contas.contaDoLogin(token))?.id).toBe(conta.id)
    await contas.encerrarLogin(token)
    expect(await contas.contaDoLogin(token)).toBeNull()
  })

  it('redefinirSenha troca a senha e encerra os logins ativos', async () => {
    const { conta } = (await cadastrar()) as { ok: true; conta: { id: string } }
    const token = await contas.criarLogin(conta.id)
    expect(await contas.redefinirSenha('ana@x.com', 'nova-senha-123')).toBe(true)
    expect(await contas.contaDoLogin(token)).toBeNull()
    expect(await contas.verificar('ana@x.com', 'nova-senha-123')).not.toBeNull()
  })
})

describe('grupo e conexão', () => {
  it('definirGrupo e marcarConectada persistem; conectadas lista só quem está conectada', async () => {
    const { conta } = (await cadastrar()) as { ok: true; conta: { id: string } }
    await contas.definirGrupo(conta.id, 'g1@g.us', 'Grupo 1')
    await contas.marcarConectada(conta.id, true)
    expect(await contas.porId(conta.id)).toMatchObject({ grupoId: 'g1@g.us', grupoNome: 'Grupo 1' })
    expect(await contas.conectadas()).toEqual([conta.id])
    await contas.marcarConectada(conta.id, false)
    expect(await contas.conectadas()).toEqual([])
  })
})
