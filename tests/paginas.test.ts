import { describe, expect, it } from 'vitest'
import { fragmentoPainel, paginaAdmin, paginaCadastro, paginaEntrar, paginaPainel, passoDe } from '../src/paginas'
import type { Conta } from '../src/contas'
import type { Convite } from '../src/convites'
import type { Visao } from '../src/sessoes'

const conta: Conta = { id: 'c1', email: 'ana@x.com' }
const comGrupo: Conta = { ...conta, grupoId: 'g1@g.us', grupoNome: 'Casa' }
const grupos = [{ id: 'g1@g.us', nome: 'Casa' }]
const frag = (visao: Visao, c: Conta = conta) => fragmentoPainel({ visao, conta: c, grupos, qrSvg: '<svg></svg>' })
const passoAtual = (html: string) => /<li[^>]*aria-current="step"[^>]*>([\s\S]*?)<\/li>/.exec(html)?.[1] ?? ''

describe('marca e prévia do bot nas telas de entrada', () => {
  it.each([
    ['entrar', paginaEntrar()],
    ['cadastro', paginaCadastro()],
  ])('%s: logo, tagline e prévia da mensagem do bot', (_n, html) => {
    expect(html).toContain('WCOEN')
    expect(html).toContain('Seu controle financeiro pelo WhatsApp')
    expect(html).toContain('BALANCETE DO DIA')
    expect(html).toMatch(/role="img"[^>]*aria-label="Exemplo de mensagem do bot/)
  })
})

describe('formulários acessíveis', () => {
  it('rótulos visíveis, autocomplete e tipos certos', () => {
    const html = paginaEntrar()
    expect(html).toMatch(/<label[^>]*for="email"/)
    expect(html).toMatch(/<label[^>]*for="senha"/)
    expect(html).toContain('autocomplete="username"')
    expect(html).toContain('autocomplete="current-password"')
    expect(html).not.toMatch(/<input[^>]*placeholder="(E-mail|Senha)"/) // placeholder nunca substitui rótulo
  })

  it('erro de login: aviso com role=alert e e-mail digitado preservado (escapado)', () => {
    const html = paginaEntrar('E-mail ou senha incorretos.', '<b>@x.com')
    expect(html).toMatch(/role="alert"[^>]*>[\s\S]*E-mail ou senha incorretos\./)
    expect(html).toContain('value="&lt;b&gt;@x.com"')
    expect(html).not.toContain('value="<b>')
  })

  it('erro de cadastro fica junto do campo: aria-invalid + aria-describedby apontando para a mensagem', () => {
    const html = paginaCadastro('Código de convite inválido.', 'convite', 'ana@x.com')
    expect(html).toMatch(/<input[^>]*name="convite"[^>]*aria-invalid="true"[^>]*aria-describedby="erro-convite"|<input[^>]*name="convite"[^>]*aria-describedby="erro-convite"[^>]*aria-invalid="true"/)
    expect(html).toMatch(/id="erro-convite"[^>]*role="alert"|role="alert"[^>]*id="erro-convite"/)
    expect(html).toContain('Código de convite inválido.')
    expect(html).toContain('value="ana@x.com"')
    expect(html).not.toMatch(/name="email"[^>]*aria-invalid/) // só o campo com problema
  })
})

describe('painel: indicador de passos e status', () => {
  it.each([
    ['desconectado', { estado: 'desconectado' }, conta, 'Conectar'],
    ['conectando', { estado: 'conectando' }, conta, 'Conectar'],
    ['aguardando_qr', { estado: 'aguardando_qr', qr: 'QR' }, conta, 'Conectar'],
    ['conectado sem grupo', { estado: 'conectado' }, conta, 'Grupo'],
    ['conectado com grupo', { estado: 'conectado' }, comGrupo, 'Pronto'],
  ] as [string, Visao, Conta, string][])('%s: passo atual = %s', (_n, visao, c, esperado) => {
    const html = frag(visao, c)
    expect(html).toMatch(/<ol[^>]*aria-label="Progresso/)
    expect(passoAtual(html)).toContain(esperado)
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1)
  })

  it.each([
    [{ estado: 'desconectado' }, 'Desconectado'],
    [{ estado: 'conectando' }, 'Conectando'],
    [{ estado: 'aguardando_qr', qr: 'QR' }, 'Aguardando leitura'],
    [{ estado: 'conectado' }, 'Conectado'],
  ] as [Visao, string][])('chip de status em texto (não só cor): %s', (visao, texto) => {
    expect(frag(visao)).toMatch(new RegExp(`class="chip[^"]*"[^>]*>[\\s\\S]*${texto}`))
  })

  it('o passo do SSE continua o mesmo de antes', () => {
    expect(passoDe({ estado: 'conectado' }, comGrupo)).toBe('conectado:pronto')
    expect(passoDe({ estado: 'aguardando_qr', codigo: 'ABCD1234' }, conta)).toBe('aguardando_qr:codigo')
  })

  it('pronto: comandos em cartões e o grupo escapado', () => {
    const html = frag({ estado: 'conectado' }, { ...comGrupo, grupoNome: '<i>Casa</i>' })
    expect(html).toContain('&lt;i&gt;Casa&lt;/i&gt;')
    for (const c of ['mercado 45,90', '+ 70 plantão', 'balancete', 'extrato', 'desfazer', 'ajuda']) expect(html).toContain(c)
  })

  it('área que o SSE atualiza é região viva (aria-live) e o painel traz o e-mail escapado', () => {
    const html = paginaPainel('<b>@x.com', frag({ estado: 'desconectado' }), 'desconectado')
    expect(html).toMatch(/id="estado"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="estado"/)
    expect(html).toContain('&lt;b&gt;@x.com')
    expect(html).not.toContain('<b>@x.com')
  })
})

describe('regras gerais das páginas', () => {
  const todas = [paginaEntrar(), paginaCadastro(), paginaPainel('a@x.com', frag({ estado: 'desconectado' }), 'desconectado')]

  it('nada carrega recurso externo (a CSP só permite o próprio site)', () => {
    for (const html of todas) {
      expect(html).not.toMatch(/https?:\/\//)
      expect(html).not.toContain('@import')
    }
  })

  it('modo escuro, movimento reduzido e anel de foco visível', () => {
    for (const html of todas) {
      expect(html).toContain('prefers-color-scheme:dark')
      expect(html).toContain('prefers-reduced-motion')
      expect(html).toContain(':focus-visible')
    }
  })

  it('viewport e idioma para celular e leitores de tela', () => {
    for (const html of todas) {
      expect(html).toContain('name="viewport"')
      expect(html).toContain('lang="pt-BR"')
    }
  })

  it('ícones de interface são SVG decorativos (aria-hidden), sem emoji de UI nos botões', () => {
    const html = frag({ estado: 'desconectado' })
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/)
    expect(html).not.toMatch(/<button[^>]*>[^<]*[\u{1F300}-\u{1FAFF}]/u)
  })
})

describe('link de administração no painel', () => {
  it('só aparece quando admin=true', () => {
    expect(paginaPainel('a@x.com', 'x', 'desconectado')).not.toContain('href="/admin"')
    expect(paginaPainel('a@x.com', 'x', 'desconectado', undefined, true)).toContain('href="/admin"')
  })
})

describe('página de administração (convites)', () => {
  const aberto: Convite = { id: 'i1', codigo: 'aaaa11111', nota: 'para o <b>João</b>', criadoEm: new Date('2026-09-27T12:00:00Z') }
  const usado: Convite = { id: 'i2', codigo: 'bbbb22222', criadoEm: new Date('2026-09-20T12:00:00Z'), usadoEm: new Date('2026-09-21T12:00:00Z') }

  it('sem convites: mensagem vazia e o formulário de criação continua lá', () => {
    const html = paginaAdmin('admin@x.com', [])
    expect(html).toContain('Nenhum convite')
    expect(html).toMatch(/<form[^>]*action="\/admin\/convites"/)
  })

  it('lista convites com código, nota escapada, status e botão de revogar só no aberto', () => {
    const html = paginaAdmin('admin@x.com', [aberto, usado])
    expect(html).toContain('aaaa11111')
    expect(html).toContain('bbbb22222')
    expect(html).toContain('para o &lt;b&gt;João&lt;/b&gt;')
    expect(html).not.toContain('para o <b>João</b>')
    expect(html).toMatch(/aaaa11111[\s\S]*Aberto/)
    expect(html).toMatch(/bbbb22222[\s\S]*Usado/)
    const revogarPorId = (id: string) => new RegExp('action="/admin/convites/revogar"[\\s\\S]*?value="' + id + '"')
    expect(html).toMatch(revogarPorId('i1'))
    // o convite usado não tem form de revogar com o seu id
    const formsRevogar = [...html.matchAll(/<form method="post" action="\/admin\/convites\/revogar">[\s\S]*?<\/form>/g)]
    expect(formsRevogar).toHaveLength(1)
  })

  it('e-mail do admin aparece escapado no topo', () => {
    expect(paginaAdmin('<i>@x.com', [])).toContain('&lt;i&gt;@x.com')
  })
})
