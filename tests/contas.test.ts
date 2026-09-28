import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { criarContas, type Contas } from '../src/contas'
import { criarConvites } from '../src/convites'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen_test'
const pool = new Pool({ connectionString: URL })
let contas: Contas

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS redefinicoes_senha')
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

  it('cadastro com convite dinâmico e e-mail inválido não consome o convite', async () => {
    await pool.query('DROP TABLE IF EXISTS convites')
    const convites = await criarConvites(pool)
    const comConvites = await criarContas(pool, { convite: 'segredo', convites })
    const { codigo } = await convites.criar('admin1')
    expect(await comConvites.cadastrar('sem-arroba', 'senha-boa-123', codigo)).toEqual({ ok: false, erro: 'email_invalido' })
    expect(await convites.existe(codigo)).toBe(true)
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

  // Review Focus do plano: login expirado precisa continuar recusando mesmo sem o TTL automático que o Mongo tinha.
  it('login expirado (contaDoLogin) recusa mesmo sem TTL automático do banco', async () => {
    const { conta } = (await cadastrar()) as { ok: true; conta: { id: string } }
    const token = await contas.criarLogin(conta.id)
    const idLogin = createHash('sha256').update(token).digest('hex')
    await pool.query("UPDATE logins SET expira_em = now() - interval '1 second' WHERE id = $1", [idLogin])
    expect(await contas.contaDoLogin(token)).toBeNull()
  })

  it('senha errada ou e-mail desconhecido em verificar dá null', async () => {
    await cadastrar()
    expect(await contas.verificar('ana@x.com', 'senha-errada')).toBeNull()
    expect(await contas.verificar('ninguem@x.com', 'senha-boa-123')).toBeNull()
  })

  it('redefinirSenha com e-mail inexistente ou senha curta dá false', async () => {
    await cadastrar()
    expect(await contas.redefinirSenha('ninguem@x.com', 'nova-senha-123')).toBe(false)
    expect(await contas.redefinirSenha('ana@x.com', '123')).toBe(false)
  })

  it('token desconhecido em contaDoLogin dá null', async () => {
    expect(await contas.contaDoLogin('token-que-nunca-existiu')).toBeNull()
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
