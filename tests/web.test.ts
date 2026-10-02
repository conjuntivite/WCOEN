import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Pool } from 'pg'
import { criarContas, criarLimitador, type Contas } from '../src/contas'
import { criarConvites, type Convites } from '../src/convites'
import { criarWeb } from '../src/web'
import type { Sessoes, Visao } from '../src/sessoes'
import type { Mailer } from '../src/mailer'
import { criarRepo, type Repositorio } from '../src/repo'
import { criarContasCorrentes, type ContasCorrentes } from '../src/contasCorrentes'

// nome DB_URL (não URL): o global URL é usado nos testes de esqueci-senha pra extrair o token do link
const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen_test'
const pool = new Pool({ connectionString: DB_URL })

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

function mailerFalso() {
  return { enviarRedefinicaoSenha: vi.fn(async (_destino: string, _link: string) => {}) }
}

const EMAIL_ADMIN = 'admin@x.com'
let contas: Contas
let contasCorrentes: ContasCorrentes
let convites: Convites
let sessoes: ReturnType<typeof sessoesFalsas>
let mailer: ReturnType<typeof mailerFalso>
let repoFalso: { repoDe: ReturnType<typeof vi.fn>; leitura: ReturnType<typeof vi.fn> }
let cookieAdmin: string
let server: Server
let base = ''

beforeAll(async () => {
  await pool.query('DROP TABLE IF EXISTS logins')
  await pool.query('DROP TABLE IF EXISTS redefinicoes_senha')
  await pool.query('DROP TABLE IF EXISTS contas')
  await pool.query('DROP TABLE IF EXISTS convites')
  convites = await criarConvites(pool)
  contas = await criarContas(pool, { convite: 'segredo', convites })
  await pool.query('DROP TABLE IF EXISTS contas_correntes')
  await criarRepo(pool) // cria `lancamentos` (a migração das contas correntes lê essa tabela)
  contasCorrentes = await criarContasCorrentes(pool)
  repoFalso = {
    repoDe: vi.fn(),
    leitura: vi.fn((_id: string) => ({
      serieMensal: async () => [{ ano: 2026, mes: 9, receitas: 123400, despesas: 5600 }],
      balancete: async () => ({ receitas: [], despesas: [{ conta: 'mercado-teste', total: 5600 }] }),
    })),
  }
  sessoes = sessoesFalsas()
  mailer = mailerFalso()
  server = criarWeb({
    contas,
    sessoes: sessoes as unknown as Sessoes,
    convites,
    mailer,
    adminEmails: [EMAIL_ADMIN],
    limitador: criarLimitador(5, 60_000),
    cookieSeguro: true,
    confiarProxy: true,
    repo: repoFalso as unknown as Repositorio,
    contasCorrentes,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
  await pool.end()
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
// /esqueci-senha responde antes de terminar o trabalho (fire-and-forget, contra timing oracle) — espera a condição bater
async function esperarAte(condicao: () => boolean, tentativas = 100, intervaloMs = 5) {
  for (let i = 0; i < tentativas && !condicao(); i++) await new Promise((r) => setTimeout(r, intervaloMs))
}

let seq = 0
async function entrar(email = `u${++seq}@x.com`) {
  const r = await post('/cadastro', { email, senha: 'senha-boa-123', convite: 'segredo' })
  expect(r.status).toBe(303)
  const cookie = r.headers.getSetCookie()[0].split(';')[0]
  const conta = (await contas.porEmail(email))!
  return { cookie, conta }
}

async function entrarComo(email: string, senha: string) {
  const r = await post('/entrar', { email, senha })
  expect(r.status).toBe(303)
  return r.headers.getSetCookie()[0].split(';')[0]
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

  it('erro de cadastro aparece junto do campo certo e o e-mail digitado é preservado', async () => {
    const r = await post('/cadastro', { email: 'ana@x.com', senha: 'senha-boa-123', convite: 'errado' })
    const html = await r.text()
    expect(html).toMatch(/name="convite"[^>]*aria-invalid="true"/)
    expect(html).not.toMatch(/name="senha"[^>]*aria-invalid/)
    expect(html).toContain('value="ana@x.com"')
    const curta = await (await post('/cadastro', { email: 'b@x.com', senha: '123', convite: 'segredo' })).text()
    expect(curta).toMatch(/name="senha"[^>]*aria-invalid="true"/)
  })

  it('login errado preserva o e-mail digitado', async () => {
    const html = await (await post('/entrar', { email: 'sem@conta.com', senha: 'errada-errada' })).text()
    expect(html).toContain('value="sem@conta.com"')
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

  it('/app.js (menu e tema) é servido como JavaScript', async () => {
    const js = await get('/app.js')
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(await js.text()).toContain('localStorage')
  })
})

describe('saúde', () => {
  it('/saude responde 200 sem exigir login (usado pelo auto-ping e pelo health check do host)', async () => {
    const r = await get('/saude')
    expect(r.status).toBe(200)
  })
})

describe('admin', () => {
  const codigoPorNota = (html: string, nota: string) => new RegExp('<code>([0-9a-f]{10})</code> <span class="sub">· ' + nota + '</span>').exec(html)?.[1]
  // uma conta admin só, reaproveitada nos testes (cadastrar de novo com o mesmo e-mail falharia com email_em_uso);
  // cookieAdmin é módulo-escopo (declarado acima) porque describe('admin: contas') também usa
  beforeAll(async () => {
    ;({ cookie: cookieAdmin } = await entrar(EMAIL_ADMIN))
  })

  it('/admin sem login redireciona para /entrar', async () => {
    expect((await get('/admin')).headers.get('location')).toBe('/entrar')
  })

  it('/admin logado, mas não-admin: 403 (GET e POST)', async () => {
    const { cookie } = await entrar()
    expect((await get('/admin', cookie)).status).toBe(403)
    expect((await post('/admin/convites', { nota: 'x' }, { cookie })).status).toBe(403)
    expect((await post('/admin/convites/revogar', { id: 'x' }, { cookie })).status).toBe(403)
  })

  it('admin vê a página e o link "Administração" aparece só para ele no painel', async () => {
    const { cookie: cookieComum } = await entrar()
    expect((await get('/admin', cookieAdmin)).status).toBe(200)
    expect(await (await get('/painel', cookieAdmin)).text()).toContain('href="/admin"')
    expect(await (await get('/painel', cookieComum)).text()).not.toContain('href="/admin"')
  })

  it('admin cria um convite (com nota escapada) e ele aparece na lista como aberto', async () => {
    const r = await post('/admin/convites', { nota: '<b>fulano</b>' }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin')
    const html = await (await get('/admin', cookieAdmin)).text()
    expect(html).toContain('&lt;b&gt;fulano&lt;/b&gt;')
    expect(html).toMatch(/&lt;b&gt;fulano&lt;\/b&gt;<\/span>[\s\S]{0,80}Aberto/)
  })

  it('o convite criado pelo admin serve para um cadastro (uso único) e some de "abertos"', async () => {
    await post('/admin/convites', { nota: 'nota-uso-unico' }, { cookie: cookieAdmin })
    const codigo = codigoPorNota(await (await get('/admin', cookieAdmin)).text(), 'nota-uso-unico')!
    expect(codigo).toBeTruthy()

    const cad1 = await post('/cadastro', { email: 'via-convite@x.com', senha: 'senha-boa-123', convite: codigo })
    expect(cad1.status).toBe(303)
    const cad2 = await post('/cadastro', { email: 'outro@x.com', senha: 'senha-boa-123', convite: codigo })
    expect(cad2.status).toBe(400)

    const htmlDepois = await (await get('/admin', cookieAdmin)).text()
    expect(htmlDepois).toMatch(new RegExp(`<code>${codigo}</code>[\\s\\S]{0,150}Usado`))
  })

  it('revogar remove um convite aberto; o código revogado não serve mais para cadastro', async () => {
    await post('/admin/convites', { nota: 'nota-para-revogar' }, { cookie: cookieAdmin })
    const html1 = await (await get('/admin', cookieAdmin)).text()
    const codigo = codigoPorNota(html1, 'nota-para-revogar')!
    // id do form de revogar associado a esse código: procura o bloco <li> inteiro
    const bloco = new RegExp(`<li class="convite"><div><code>${codigo}</code>[\\s\\S]*?</li>`).exec(html1)?.[0] ?? ''
    const id = /value="([0-9a-f-]{36})"/.exec(bloco)?.[1]
    expect(id).toBeTruthy()

    const r = await post('/admin/convites/revogar', { id: id! }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin')
    expect(await (await get('/admin', cookieAdmin)).text()).not.toContain(codigo)

    const cad = await post('/cadastro', { email: 'depois-de-revogado@x.com', senha: 'senha-boa-123', convite: codigo })
    expect(cad.status).toBe(400)
  })
})

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
    await esperarAte(() => mailer.enviarRedefinicaoSenha.mock.calls.length >= 1)
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
    await esperarAte(() => mailer.enviarRedefinicaoSenha.mock.calls.length >= 1)
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
    await esperarAte(() => mailer.enviarRedefinicaoSenha.mock.calls.length >= 1)
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
    await esperarAte(() => mailer.enviarRedefinicaoSenha.mock.calls.length >= 1)
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
    await esperarAte(() => mailer.enviarRedefinicaoSenha.mock.calls.length >= 5)
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledTimes(5)
    const r = await post('/esqueci-senha', { email: 'limite@x.com' }, mesmoIp)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('Se esse e-mail existir na nossa base')
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledTimes(5)
  })

  // Correção da revisão final: IP bloqueado em /entrar (senha errada) não pode bloquear /esqueci-senha,
  // senão a pessoa fica sem conseguir recuperar a senha justamente quando mais precisa.
  it('IP bloqueado em /entrar por senha errada não impede /esqueci-senha de mandar o e-mail', async () => {
    const mesmoIp = { 'X-Forwarded-For': '203.0.113.77' }
    await entrar('bloqueado-entrar@x.com')
    for (let i = 0; i < 5; i++) await post('/entrar', { email: 'bloqueado-entrar@x.com', senha: 'errada-errada' }, mesmoIp)
    expect((await post('/entrar', { email: 'bloqueado-entrar@x.com', senha: 'senha-boa-123' }, mesmoIp)).status).toBe(429)

    const r = await post('/esqueci-senha', { email: 'bloqueado-entrar@x.com' }, mesmoIp)
    expect(r.status).toBe(200)
    await esperarAte(() => mailer.enviarRedefinicaoSenha.mock.calls.length >= 1)
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledWith('bloqueado-entrar@x.com', expect.stringContaining('/redefinir-senha?token='))
  })

  it('sem mailer configurado, ainda funciona: loga o link no console em vez de falhar', async () => {
    const semMailer = criarWeb({
      contas,
      contasCorrentes,
      sessoes: sessoes as unknown as Sessoes,
      convites,
      adminEmails: [EMAIL_ADMIN],
      limitador: criarLimitador(5, 60_000),
      cookieSeguro: true,
      confiarProxy: true,
      repo: repoFalso as unknown as Repositorio,
    })
    await new Promise<void>((r) => semMailer.listen(0, '127.0.0.1', r))
    const baseSemMailer = `http://127.0.0.1:${(semMailer.address() as AddressInfo).port}`
    const postSemMailer = (caminho: string, dados: Record<string, string>) =>
      fetch(baseSemMailer + caminho, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseSemMailer }, body: form(dados) })
    await postSemMailer('/cadastro', { email: 'semmailer@x.com', senha: 'senha-boa-123', convite: 'segredo' })

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await postSemMailer('/esqueci-senha', { email: 'semmailer@x.com' })
    expect(r.status).toBe(200)
    await esperarAte(() => log.mock.calls.length >= 1)
    expect(log.mock.calls.flat().join(' ')).toContain('/redefinir-senha?token=')
    log.mockRestore()

    semMailer.closeAllConnections()
    await new Promise((r) => semMailer.close(r))
  })

  // Review Focus: o link não pode confiar no Host da requisição (forjável fora de browser) — só no `dominio` configurado.
  it('com `dominio` configurado, o link usa esse domínio, não o Host da requisição', async () => {
    const mailerDominio = mailerFalso()
    const comDominio = criarWeb({
      contas,
      contasCorrentes,
      sessoes: sessoes as unknown as Sessoes,
      convites,
      mailer: mailerDominio,
      adminEmails: [EMAIL_ADMIN],
      limitador: criarLimitador(5, 60_000),
      cookieSeguro: true,
      confiarProxy: true,
      dominio: 'app.exemplo.com',
      repo: repoFalso as unknown as Repositorio,
    })
    await new Promise<void>((r) => comDominio.listen(0, '127.0.0.1', r))
    const baseComDominio = `http://127.0.0.1:${(comDominio.address() as AddressInfo).port}`
    const postComDominio = (caminho: string, dados: Record<string, string>) =>
      fetch(baseComDominio + caminho, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseComDominio }, body: form(dados) })
    await postComDominio('/cadastro', { email: 'comdominio@x.com', senha: 'senha-boa-123', convite: 'segredo' })

    const r = await postComDominio('/esqueci-senha', { email: 'comdominio@x.com' })
    expect(r.status).toBe(200)
    await esperarAte(() => mailerDominio.enviarRedefinicaoSenha.mock.calls.length >= 1)
    const [, link] = mailerDominio.enviarRedefinicaoSenha.mock.calls[0]
    // a requisição chegou em 127.0.0.1:<porta-efêmera> (Host real), mas o link tem que usar o domínio configurado
    expect(link).toMatch(/^https:\/\/app\.exemplo\.com\/redefinir-senha\?token=/)

    comDominio.closeAllConnections()
    await new Promise((r) => comDominio.close(r))
  })
})

describe('sem acesso dev', () => {
  it('o antigo login dev@x.com não existe: não entra e esqueci-senha não manda nada', async () => {
    expect((await post('/entrar', { email: 'dev@x.com', senha: 'senha-dev-123' })).status).toBe(401)
    await post('/esqueci-senha', { email: 'dev@x.com' })
    await new Promise((r) => setTimeout(r, 100))
    expect(mailer.enviarRedefinicaoSenha).not.toHaveBeenCalled()
  })
})

describe('admin: contas', () => {
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
    await post('/admin/contas/redefinir', { id: conta.id }, { cookie: cookieAdmin })
    expect(mailer.enviarRedefinicaoSenha).toHaveBeenCalledWith('contaadmin2@x.com', expect.stringContaining('/redefinir-senha?token='))
  })

  it('rotas de contas exigem admin (403 pra quem não é)', async () => {
    const { cookie } = await entrar('naoadmin@x.com')
    for (const rota of ['desativar', 'reativar', 'redefinir', 'papel']) expect((await post(`/admin/contas/${rota}`, { id: 'x' }, { cookie })).status).toBe(403)
  })

  it('não existe mais exclusão de conta: a rota dá 404, até para o admin', async () => {
    const { conta } = await entrar('naoexcluivel@x.com')
    const r = await post('/admin/contas/excluir', { id: conta.id, confirmarEmail: 'naoexcluivel@x.com' }, { cookie: cookieAdmin })
    expect(r.status).toBe(404)
    expect(await contas.porId(conta.id)).not.toBeNull()
    const html = await (await get('/admin', cookieAdmin)).text()
    expect(html).not.toContain('Excluir')
  })

  it('redefinir com sucesso mostra aviso em /admin', async () => {
    const { conta } = await entrar('feedback-redefinir@x.com')
    const r = await post('/admin/contas/redefinir', { id: conta.id }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin?ok=redefinicao')
    const html = await (await get('/admin?ok=redefinicao', cookieAdmin)).text()
    expect(html).toContain('Link de redefinição enviado.')
  })
})

describe('admin: permissões', () => {
  it('a tela mostra o seletor de papel (Administrador, Usuário, Usuário com validade) e o campo de data', async () => {
    await entrar('menu-papel@x.com')
    const html = await (await get('/admin', cookieAdmin)).text()
    expect(html).toContain('action="/admin/contas/papel"')
    for (const rotulo of ['Administrador', 'Usuário com validade']) expect(html).toContain(rotulo)
    expect(html).toContain('type="date"')
  })

  it('promover a admin: a conta passa a ver /admin; voltar a usuário tira o acesso', async () => {
    const { cookie, conta } = await entrar('promovida@x.com')
    expect((await get('/admin', cookie)).status).toBe(403)
    const r = await post('/admin/contas/papel', { id: conta.id, papel: 'admin' }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin?ok=papel')
    expect((await get('/admin', cookie)).status).toBe(200)
    await post('/admin/contas/papel', { id: conta.id, papel: 'usuario' }, { cookie: cookieAdmin })
    expect((await get('/admin', cookie)).status).toBe(403)
  })

  it('usuário com validade: guarda a data; sem data ou com data inválida volta com aviso e não muda nada', async () => {
    const { conta } = await entrar('validade@x.com')
    const ok = await post('/admin/contas/papel', { id: conta.id, papel: 'validade', ate: '2099-12-31' }, { cookie: cookieAdmin })
    expect(ok.headers.get('location')).toBe('/admin?ok=papel')
    expect(await contas.porId(conta.id)).toMatchObject({ papel: 'usuario', validadeAte: '2099-12-31' })
    expect(await (await get('/admin', cookieAdmin)).text()).toContain('31/12/2099')

    for (const ate of ['', 'abc', '2099-02-30']) {
      const r = await post('/admin/contas/papel', { id: conta.id, papel: 'validade', ate }, { cookie: cookieAdmin })
      expect(r.headers.get('location')).toBe('/admin?erro=data')
    }
    expect(await contas.porId(conta.id)).toMatchObject({ validadeAte: '2099-12-31' })
    expect(await (await get('/admin?erro=data', cookieAdmin)).text()).toContain('Data inválida')
  })

  it('papel desconhecido é ignorado; id inexistente não quebra', async () => {
    const { conta } = await entrar('papel-estranho@x.com')
    const r = await post('/admin/contas/papel', { id: conta.id, papel: 'dev' }, { cookie: cookieAdmin })
    expect(r.status).toBe(303)
    expect(await contas.porId(conta.id)).toMatchObject({ papel: 'usuario' })
    expect((await post('/admin/contas/papel', { id: 'nunca-existiu', papel: 'admin' }, { cookie: cookieAdmin })).status).toBe(303)
  })

  it('o admin não altera o próprio papel', async () => {
    const eu = (await contas.porEmail(EMAIL_ADMIN))!
    const r = await post('/admin/contas/papel', { id: eu.id, papel: 'usuario' }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin?erro=proprio')
    expect((await get('/admin', cookieAdmin)).status).toBe(200)
  })

  it('admin fixo (ADMIN_EMAILS) não é rebaixado por outro admin do banco', async () => {
    const { cookie, conta } = await entrar('segundo-admin@x.com')
    await post('/admin/contas/papel', { id: conta.id, papel: 'admin' }, { cookie: cookieAdmin })
    const fixo = (await contas.porEmail(EMAIL_ADMIN))!
    const r = await post('/admin/contas/papel', { id: fixo.id, papel: 'usuario' }, { cookie })
    expect(r.headers.get('location')).toBe('/admin?erro=fixo')
    expect(await (await get('/admin', cookieAdmin)).text()).toContain('Administrador')
  })

  it('conta vencida não entra: senha certa avisa que o acesso expirou; senha errada segue como erro comum', async () => {
    const { conta } = await entrar('vencida-web@x.com')
    await contas.definirPapel(conta.id, 'usuario', '2000-01-01')
    const certa = await post('/entrar', { email: 'vencida-web@x.com', senha: 'senha-boa-123' })
    expect(certa.status).toBe(401)
    expect(await certa.text()).toContain('Seu acesso expirou')
    expect(certa.headers.getSetCookie()).toEqual([])
    const errada = await post('/entrar', { email: 'vencida-web@x.com', senha: 'errada-123' })
    expect(await errada.text()).not.toContain('Seu acesso expirou')
  })

  it('o admin consegue estender a validade de uma conta que já venceu (e de uma desativada)', async () => {
    const { conta } = await entrar('renovar@x.com')
    await contas.definirPapel(conta.id, 'usuario', '2000-01-01')
    expect((await post('/entrar', { email: 'renovar@x.com', senha: 'senha-boa-123' })).status).toBe(401)
    const r = await post('/admin/contas/papel', { id: conta.id, papel: 'validade', ate: '2099-12-31' }, { cookie: cookieAdmin })
    expect(r.headers.get('location')).toBe('/admin?ok=papel')
    expect((await post('/entrar', { email: 'renovar@x.com', senha: 'senha-boa-123' })).status).toBe(303)
  })

  it('a sessão aberta de uma conta vencida cai no mesmo instante', async () => {
    const { cookie, conta } = await entrar('vence-logada@x.com')
    expect((await get('/painel', cookie)).status).toBe(200)
    await contas.definirPapel(conta.id, 'usuario', '2000-01-01')
    expect((await get('/painel', cookie)).headers.get('location')).toBe('/entrar')
  })
})

describe('GET /dashboard', () => {
  it('sem login redireciona para /entrar', async () => {
    const r = await get('/dashboard')
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/entrar')
  })

  it('usuário comum lê só a própria conta, mesmo forjando ?conta=', async () => {
    const a = await entrar()
    const b = await entrar()
    const r = await get(`/dashboard?conta=${b.conta.id}`, a.cookie)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('mercado-teste')
    expect(html).not.toContain('<select')
    expect(repoFalso.leitura).toHaveBeenCalledTimes(1)
    expect(repoFalso.leitura).toHaveBeenCalledWith(a.conta.id)
  })

  it('admin também lê só a própria conta, mesmo forjando ?conta=', async () => {
    const outra = await entrar()
    const cookie = await entrarComo(EMAIL_ADMIN, 'senha-boa-123')
    const eu = (await contas.porEmail(EMAIL_ADMIN))!
    const html = await (await get(`/dashboard?conta=${outra.conta.id}`, cookie)).text()
    expect(html).not.toContain('<select')
    expect(html).not.toContain(outra.conta.email)
    expect(repoFalso.leitura).toHaveBeenCalledTimes(1)
    expect(repoFalso.leitura).toHaveBeenCalledWith(eu.id)
  })
})

describe('contas correntes', () => {
  it('exige login', async () => {
    expect((await get('/contas-correntes')).headers.get('location')).toBe('/entrar')
    expect((await post('/contas-correntes', { apelido: 'x', nome: 'X' })).headers.get('location')).toBe('/entrar')
    expect((await post('/contas-correntes/favoritar', { id: 'x' })).headers.get('location')).toBe('/entrar')
  })

  it('GET mostra a Principal criada sozinha', async () => {
    const { cookie } = await entrar()
    const r = await get('/contas-correntes', cookie)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('@principal')
    expect(html).toContain('Favorita')
  })

  it('cria conta com saldo, mostra aviso e recusa dados inválidos com a chave de erro', async () => {
    const { cookie, conta } = await entrar()
    const ok = await post('/contas-correntes', { apelido: 'Nubank', nome: 'Nubank', saldo: '1.500,50' }, { cookie })
    expect(ok.headers.get('location')).toBe('/contas-correntes?ok=criada')
    expect(await contasCorrentes.doCliente(conta.id).porApelido('nubank')).toMatchObject({ nome: 'Nubank', saldoInicial: 150050 })
    expect((await post('/contas-correntes', { apelido: 'nubank', nome: 'Outra' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=apelido_em_uso')
    expect((await post('/contas-correntes', { apelido: 'com espaço', nome: 'X' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=apelido_invalido')
    expect((await post('/contas-correntes', { apelido: 'x1', nome: '  ' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=nome_invalido')
    expect((await post('/contas-correntes', { apelido: 'x2', nome: 'X', saldo: 'abc' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=saldo_invalido')
    expect(await (await get('/contas-correntes?ok=criada', cookie)).text()).toContain('Conta criada.')
    expect(await (await get('/contas-correntes?erro=apelido_em_uso', cookie)).text()).toContain('já tem uma conta com esse apelido')
    expect(await (await get('/contas-correntes?erro=<script>', cookie)).text()).not.toContain('<script>')
  })

  it('saldo inicial negativo e vazio', async () => {
    const { cookie, conta } = await entrar()
    await post('/contas-correntes', { apelido: 'neg', nome: 'Neg', saldo: '-50' }, { cookie })
    await post('/contas-correntes', { apelido: 'zero', nome: 'Zero', saldo: '' }, { cookie })
    expect((await contasCorrentes.doCliente(conta.id).porApelido('neg'))!.saldoInicial).toBe(-5000)
    expect((await contasCorrentes.doCliente(conta.id).porApelido('zero'))!.saldoInicial).toBe(0)
  })

  it('editar, favoritar, desativar e reativar', async () => {
    const { cookie, conta } = await entrar()
    await post('/contas-correntes', { apelido: 'nubank', nome: 'Nubank' }, { cookie })
    const nu = (await contasCorrentes.doCliente(conta.id).porApelido('nubank'))!
    expect((await post('/contas-correntes/editar', { id: nu.id, nome: 'Nu Conta', saldo: '10' }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=salva')
    expect(await contasCorrentes.doCliente(conta.id).porApelido('nubank')).toMatchObject({ nome: 'Nu Conta', saldoInicial: 1000 })
    expect((await post('/contas-correntes/editar', { id: nu.id, nome: ' ', saldo: '10' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=nome_invalido')
    expect((await post('/contas-correntes/editar', { id: nu.id, nome: 'X', saldo: 'abc' }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=saldo_invalido')
    expect((await post('/contas-correntes/desativar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=desativada')
    expect((await post('/contas-correntes/favoritar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=inativa')
    expect((await post('/contas-correntes/reativar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=reativada')
    expect((await post('/contas-correntes/favoritar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=favorita')
    expect((await contasCorrentes.doCliente(conta.id).favorita()).id).toBe(nu.id)
    const principal = (await contasCorrentes.doCliente(conta.id).porApelido('principal'))!
    expect((await post('/contas-correntes/desativar', { id: nu.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?erro=favorita')
    expect((await post('/contas-correntes/desativar', { id: principal.id }, { cookie })).headers.get('location')).toBe('/contas-correntes?ok=desativada')
  })

  it('não mexe na conta de outro cliente', async () => {
    const a = await entrar()
    const b = await entrar()
    await post('/contas-correntes', { apelido: 'nubank', nome: 'Nubank' }, { cookie: a.cookie })
    const alvo = (await contasCorrentes.doCliente(a.conta.id).porApelido('nubank'))!
    for (const rota of ['editar', 'favoritar', 'desativar', 'reativar']) {
      const r = await post(`/contas-correntes/${rota}`, { id: alvo.id, nome: 'Invasor', saldo: '1' }, { cookie: b.cookie })
      expect(r.headers.get('location')).toBe('/contas-correntes?erro=nao_encontrada')
    }
    expect(await contasCorrentes.doCliente(a.conta.id).porApelido('nubank')).toMatchObject({ nome: 'Nubank', ativa: true, favorita: false })
  })

  it('POST de outra origem é recusado', async () => {
    const { cookie } = await entrar()
    const r = await post('/contas-correntes', { apelido: 'x', nome: 'X' }, { cookie, Origin: 'http://evil.example' })
    expect(r.status).toBe(403)
  })
})

describe('perfil', () => {
  it('exige login', async () => {
    expect((await get('/perfil')).headers.get('location')).toBe('/entrar')
    expect((await post('/perfil', { nome: 'x' })).headers.get('location')).toBe('/entrar')
  })

  it('GET mostra a página com dados da conta e estado do WhatsApp', async () => {
    const { cookie, conta } = await entrar()
    sessoes.definir(conta.id, { estado: 'conectado' })
    const r = await get('/perfil', cookie)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain(conta.email)
    expect(html).toContain('Conectado')
  })

  it('POST /perfil salva nome, cor e ícone e o menu passa a mostrá-los', async () => {
    const { cookie, conta } = await entrar()
    const r = await post('/perfil', { nome: 'Ana Souza', cor: 'verde', icone: 'folha' }, { cookie })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/perfil?ok=salvo')
    expect(await contas.porId(conta.id)).toMatchObject({ nome: 'Ana Souza', avatarCor: 'verde', avatarIcone: 'folha' })
    const html = await (await get('/dashboard', cookie)).text()
    expect(html).toContain('Ana Souza')
    expect(html).toContain('av-verde')
    expect(await (await get('/perfil?ok=salvo', cookie)).text()).toContain('Perfil salvo.')
  })

  it('valores fora da lista não são gravados', async () => {
    const { cookie, conta } = await entrar()
    await post('/perfil', { nome: '', cor: 'azul"><script>', icone: 'nada' }, { cookie })
    const lida = (await contas.porId(conta.id))!
    expect(lida.avatarCor).toBeUndefined()
    expect(lida.avatarIcone).toBeUndefined()
  })

  it('trocar senha: confirmação diferente, senha atual errada e nova curta dão erro sem trocar', async () => {
    const { cookie, conta } = await entrar()
    const tenta = async (d: Record<string, string>) => (await post('/perfil/senha', d, { cookie })).headers.get('location')
    expect(await tenta({ atual: 'senha-boa-123', nova: 'nova-senha-1', confirmacao: 'diferente-1' })).toBe('/perfil?erro=confirmacao')
    expect(await tenta({ atual: 'errada-123', nova: 'nova-senha-1', confirmacao: 'nova-senha-1' })).toBe('/perfil?erro=senha_atual')
    expect(await tenta({ atual: 'senha-boa-123', nova: '1234567', confirmacao: '1234567' })).toBe('/perfil?erro=senha_curta')
    expect(await contas.verificar(conta.email, 'senha-boa-123')).not.toBeNull()
    expect(await (await get('/perfil?erro=senha_atual', cookie)).text()).toContain('Senha atual incorreta.')
  })

  it('trocar senha certa: vale a nova, derruba as outras sessões e mantém a atual', async () => {
    const { cookie, conta } = await entrar()
    const outroAparelho = await entrarComo(conta.email, 'senha-boa-123')
    const r = await post('/perfil/senha', { atual: 'senha-boa-123', nova: 'nova-senha-1', confirmacao: 'nova-senha-1' }, { cookie })
    expect(r.headers.get('location')).toBe('/perfil?ok=senha')
    expect(await contas.verificar(conta.email, 'nova-senha-1')).not.toBeNull()
    expect((await get('/perfil', cookie)).status).toBe(200)
    expect((await get('/perfil', outroAparelho)).headers.get('location')).toBe('/entrar')
  })

  it('senha atual errada repetida bloqueia as tentativas da conta', async () => {
    const { cookie } = await entrar()
    const tenta = () => post('/perfil/senha', { atual: 'errada-123', nova: 'nova-senha-1', confirmacao: 'nova-senha-1' }, { cookie })
    for (let i = 0; i < 5; i++) await tenta()
    expect((await tenta()).headers.get('location')).toBe('/perfil?erro=limite')
  })

  it('sair dos outros aparelhos mantém só a sessão atual', async () => {
    const { cookie, conta } = await entrar()
    const outro = await entrarComo(conta.email, 'senha-boa-123')
    const r = await post('/perfil/sair-aparelhos', {}, { cookie })
    expect(r.headers.get('location')).toBe('/perfil?ok=aparelhos')
    expect((await get('/perfil', cookie)).status).toBe(200)
    expect((await get('/perfil', outro)).headers.get('location')).toBe('/entrar')
  })
})
