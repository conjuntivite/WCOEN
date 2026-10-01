import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

  // Correção da revisão final: defesa em profundidade — mesmo sem passar pela rota HTTP (que já desconecta
  // antes de desativar), conectadas() sozinha não pode listar uma conta inativa.
  it('conectadas() não lista uma conta marcada como conectada mas desativada diretamente', async () => {
    const { conta } = (await cadastrar()) as { ok: true; conta: { id: string } }
    await contas.marcarConectada(conta.id, true)
    await contas.definirAtiva(conta.id, false)
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

describe('papel e validade', () => {
  const novaConta = async (email: string) => ((await cadastrar(email)) as { ok: true; conta: { id: string } }).conta
  // relógio fixo: 2026-10-10 12:00Z = 09:00 em São Paulo
  const comRelogio = (iso: string) => criarContas(pool, { convite: 'segredo', agora: () => new Date(iso) })

  it('conta nova é usuário, sem validade', async () => {
    const c = await novaConta('novo@x.com')
    expect(await contas.porId(c.id)).toMatchObject({ papel: 'usuario' })
    expect((await contas.porId(c.id))?.validadeAte).toBeUndefined()
  })

  it('definirPapel: admin, usuário e usuário com validade', async () => {
    const c = await novaConta('papel@x.com')
    expect(await contas.definirPapel(c.id, 'admin')).toBe('ok')
    expect(await contas.porId(c.id)).toMatchObject({ papel: 'admin' })
    expect(await contas.definirPapel(c.id, 'usuario', '2026-12-31')).toBe('ok')
    expect(await contas.porId(c.id)).toMatchObject({ papel: 'usuario', validadeAte: '2026-12-31' })
    expect(await contas.definirPapel(c.id, 'usuario')).toBe('ok') // sem data = sem validade
    expect((await contas.porId(c.id))?.validadeAte).toBeUndefined()
  })

  it('admin nunca guarda validade', async () => {
    const c = await novaConta('adm@x.com')
    await contas.definirPapel(c.id, 'usuario', '2026-12-31')
    await contas.definirPapel(c.id, 'admin', '2026-12-31')
    expect((await contas.porId(c.id))?.validadeAte).toBeUndefined()
  })

  it.each([['amanhã'], ['2026-13-40'], ['2026-02-30'], ['31/12/2026']])('data inválida %j é recusada e nada muda', async (data) => {
    const c = await novaConta('data@x.com')
    expect(await contas.definirPapel(c.id, 'usuario', data)).toBe('data_invalida')
    expect((await contas.porId(c.id))?.validadeAte).toBeUndefined()
  })

  it('vale até o último dia inteiro: no dia do término ainda entra', async () => {
    const c = await novaConta('ultimo@x.com')
    await contas.definirPapel(c.id, 'usuario', '2026-10-10')
    const hoje = await comRelogio('2026-10-10T12:00:00Z')
    expect(await hoje.verificar('ultimo@x.com', 'senha-boa-123')).not.toBeNull()
    expect(await hoje.porId(c.id)).not.toBeNull()
  })

  it('no dia seguinte: senha certa vira "expirada" e senha errada continua nula', async () => {
    const c = await novaConta('vencida@x.com')
    await contas.definirPapel(c.id, 'usuario', '2026-10-10')
    const token = await contas.criarLogin(c.id)
    const depois = await comRelogio('2026-10-11T12:00:00Z')
    expect(await depois.verificar('vencida@x.com', 'senha-boa-123')).toBe('expirada')
    expect(await depois.verificar('vencida@x.com', 'errada-123')).toBeNull()
    expect(await depois.porId(c.id)).toBeNull()
    expect(await depois.contaDoLogin(token)).toBeNull() // a sessão aberta também cai
    expect(await depois.porEmail('vencida@x.com')).toBeNull() // esqueci-senha não age
  })

  it('o dia vira à meia-noite de São Paulo, não à de UTC', async () => {
    const c = await novaConta('fuso@x.com')
    await contas.definirPapel(c.id, 'usuario', '2026-10-10')
    // 2026-10-11T01:00Z = 22:00 do dia 10 em São Paulo: ainda vale
    expect(await (await comRelogio('2026-10-11T01:00:00Z')).porId(c.id)).not.toBeNull()
    // 2026-10-11T03:00Z = 00:00 do dia 11 em São Paulo: venceu
    expect(await (await comRelogio('2026-10-11T03:00:00Z')).porId(c.id)).toBeNull()
  })

  it('conectadas() ignora vencidas; vencidasConectadas() as lista para desconectar', async () => {
    const a = await novaConta('a@x.com')
    const b = await novaConta('b@x.com')
    await contas.marcarConectada(a.id, true)
    await contas.marcarConectada(b.id, true)
    await contas.definirPapel(b.id, 'usuario', '2026-10-10')
    const depois = await comRelogio('2026-10-11T12:00:00Z')
    expect(await depois.conectadas()).toEqual([a.id])
    expect(await depois.vencidasConectadas()).toEqual([b.id])
    expect(await (await comRelogio('2026-10-10T12:00:00Z')).vencidasConectadas()).toEqual([])
  })

  it('listarContas traz papel, validade e se já venceu', async () => {
    const c = await novaConta('lista@x.com')
    await contas.definirPapel(c.id, 'usuario', '2026-10-10')
    const [r] = await (await comRelogio('2026-10-11T12:00:00Z')).listarContas()
    expect(r).toMatchObject({ email: 'lista@x.com', papel: 'usuario', validadeAte: '2026-10-10', vencida: true })
    const [r2] = await (await comRelogio('2026-10-10T12:00:00Z')).listarContas()
    expect(r2.vencida).toBe(false)
  })

  it('não existe mais acesso dev: o e-mail dev@x.com se cadastra como qualquer outro', async () => {
    expect((await cadastrar('dev@x.com')).ok).toBe(true)
  })
})

describe('perfil da conta', () => {
  const nova = async (email = 'perfil@x.com') => ((await cadastrar(email)) as { ok: true; conta: { id: string } }).conta

  it('conta nova vem sem personalização e com data de criação', async () => {
    const c = await nova()
    const lida = (await contas.porId(c.id))!
    expect(lida.nome).toBeUndefined()
    expect(lida.avatarCor).toBeUndefined()
    expect(lida.criadaEm).toBeInstanceOf(Date)
  })

  it('definirPerfil guarda nome (aparado e com no máximo 40 caracteres), cor e ícone da lista', async () => {
    const c = await nova()
    await contas.definirPerfil(c.id, { nome: '  ' + 'A'.repeat(50) + '  ', cor: 'azul', icone: 'estrela' })
    expect(await contas.porId(c.id)).toMatchObject({ nome: 'A'.repeat(40), avatarCor: 'azul', avatarIcone: 'estrela' })
  })

  it('cor e ícone fora da lista e nome vazio viram "sem valor"', async () => {
    const c = await nova()
    await contas.definirPerfil(c.id, { nome: 'Ana', cor: 'azul', icone: 'estrela' })
    await contas.definirPerfil(c.id, { nome: '   ', cor: 'url(javascript:1)', icone: '<b>' })
    const lida = (await contas.porId(c.id))!
    expect(lida.nome).toBeUndefined()
    expect(lida.avatarCor).toBeUndefined()
    expect(lida.avatarIcone).toBeUndefined()
  })

  it('trocarSenha: senha atual errada e nova curta não mudam nada; a certa troca', async () => {
    const c = await nova()
    expect(await contas.trocarSenha(c.id, 'errada-123', 'outra-senha-1')).toBe('senha_atual')
    expect(await contas.trocarSenha(c.id, 'senha-boa-123', '1234567')).toBe('senha_curta')
    expect(await contas.verificar('perfil@x.com', 'senha-boa-123')).not.toBeNull()
    expect(await contas.trocarSenha(c.id, 'senha-boa-123', 'outra-senha-1')).toBe('ok')
    expect(await contas.verificar('perfil@x.com', 'senha-boa-123')).toBeNull()
    expect(await contas.verificar('perfil@x.com', 'outra-senha-1')).not.toBeNull()
  })

  it('encerrarOutrosLogins derruba as outras sessões e mantém a informada', async () => {
    const c = await nova()
    const atual = await contas.criarLogin(c.id)
    const outro = await contas.criarLogin(c.id)
    const deOutraConta = await contas.criarLogin((await nova('outra@x.com')).id)
    await contas.encerrarOutrosLogins(c.id, atual)
    expect(await contas.contaDoLogin(atual)).not.toBeNull()
    expect(await contas.contaDoLogin(outro)).toBeNull()
    expect(await contas.contaDoLogin(deOutraConta)).not.toBeNull()
  })
})
