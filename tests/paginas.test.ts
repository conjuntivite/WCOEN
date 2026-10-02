import { describe, expect, it } from 'vitest'
import { montarIndicadores } from '../src/dashboard'
import type { ContaCorrenteComSaldo, MesSerie } from '../src/types'
import { fragmentoPainel, paginaPerfil, paginaAdmin, paginaCadastro, paginaEsqueciSenha, paginaEntrar, paginaPainel, paginaRedefinirSenha, passoDe, paginaDashboard, paginaContasCorrentes } from '../src/paginas'
import type { Conta, ContaResumo } from '../src/contas'
import type { Convite } from '../src/convites'
import type { Visao } from '../src/sessoes'

const conta: Conta = { id: 'c1', email: 'ana@x.com' }
const comGrupo: Conta = { ...conta, grupoId: 'g1@g.us', grupoNome: 'Casa' }
const grupos = [{ id: 'g1@g.us', nome: 'Casa' }]
const frag = (visao: Visao, c: Conta = conta) => fragmentoPainel({ visao, conta: c, grupos, qrSvg: '<svg></svg>' })
const cards = (html: string) => html.split('<section class="cartao passo').slice(1)
const situacao = (card: string) => (card.startsWith(' atual') ? 'atual' : card.startsWith(' feito') ? 'feito' : card.startsWith(' travado') ? 'travado' : '?')

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

describe('painel: três cards e status', () => {
  it.each([
    ['desconectado', { estado: 'desconectado' }, conta, ['atual', 'travado', 'travado']],
    ['conectando', { estado: 'conectando' }, conta, ['atual', 'travado', 'travado']],
    ['aguardando_qr', { estado: 'aguardando_qr', qr: 'QR' }, conta, ['atual', 'travado', 'travado']],
    ['conectado sem grupo', { estado: 'conectado' }, conta, ['feito', 'atual', 'travado']],
    ['conectado com grupo', { estado: 'conectado' }, comGrupo, ['feito', 'feito', 'atual']],
  ] as [string, Visao, Conta, string[]][])('%s: situação dos cards = %j', (_n, visao, c, esperado) => {
    const html = frag(visao, c)
    const cs = cards(html)
    expect(cs).toHaveLength(3)
    expect(cs.map(situacao)).toEqual(esperado)
    for (const [i, t] of ['Conectar', 'Grupo', 'Pronto'].entries()) expect(cs[i]).toContain(`</span>${t}</h2>`)
    cs.forEach((x, i) => {
      expect(x.includes('aria-current="step"')).toBe(esperado[i] === 'atual')
      expect(x.includes('aria-disabled="true"')).toBe(esperado[i] === 'travado')
    })
    expect((html.match(/aria-current="step"/g) ?? []).length).toBe(1)
    expect(html).not.toContain('class="passos"')
    expect(html).not.toContain('Progresso da configuração')
  })

  it('número vira check no card feito', () => {
    const cs = cards(frag({ estado: 'conectado' }, comGrupo))
    expect(cs[0]).toMatch(/<span class="num"><svg/)
    expect(cs[1]).toMatch(/<span class="num"><svg/)
    expect(cards(frag({ estado: 'desconectado' }))[0]).toMatch(/<span class="num">1<\/span>/)
  })

  it('comandos só no estado pronto; textos dos cards travados', () => {
    expect(frag({ estado: 'conectado' }, conta)).not.toContain('/d mercado')
    expect(frag({ estado: 'desconectado' })).not.toContain('/d mercado')
    expect(cards(frag({ estado: 'desconectado' }))[1]).toContain('Conecte o WhatsApp primeiro.')
    expect(cards(frag({ estado: 'conectado' }, conta))[2]).toContain('Escolha um grupo para liberar.')
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

  it('pronto: comandos no card 3 e o grupo escapado no card 2', () => {
    const html = frag({ estado: 'conectado' }, { ...comGrupo, grupoNome: '<i>Casa</i>' })
    expect(cards(html)[1]).toContain('&lt;i&gt;Casa&lt;/i&gt;')
    expect(html).not.toContain('<i>Casa</i>')
    for (const c of ['/d mercado 45,90', '/r plantão 70', '/balancete', '/extrato', '/desfazer', '/ajuda']) expect(html).toContain(c)
  })

  it('área que o SSE atualiza é região viva (aria-live) e o painel traz o e-mail escapado', () => {
    const html = paginaPainel('<b>@x.com', frag({ estado: 'desconectado' }), 'desconectado')
    expect(html).toMatch(/<div id="estado" class="painel-passos" data-passo="desconectado" aria-live="polite">/)
    expect(html).toContain('.painel-passos')
    expect(html).toContain('min-width:1180px')
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

describe('menu lateral das telas logadas', () => {
  const ind = { vazio: true, mes: { ano: 2026, mes: 9, receitas: 0, despesas: 0 }, serie: [], categorias: [], saldo: 0, variacao: { saldo: null, receitas: null, despesas: null } } as unknown as Parameters<typeof paginaDashboard>[1]
  const telas = {
    painel: paginaPainel('a@x.com', 'x', 'desconectado'),
    dashboard: paginaDashboard('a@x.com', ind, false),
    admin: paginaAdmin('a@x.com', []),
  }

  it('toda tela tem navegação, botão de recolher, de tema, perfil e Sair', () => {
    for (const html of Object.values(telas)) {
      expect(html).toMatch(/<nav[^>]*aria-label="Menu principal"/)
      expect(html).toContain('id="menu-alternar"')
      expect(html).toContain('id="tema-alternar"')
      expect(html).toMatch(/<details class="perfil"/)
      expect(html).toMatch(/<form method="post" action="\/sair">/)
      expect(html).toContain('<script src="/app.js"></script>')
    }
  })

  it('marca a página atual com aria-current', () => {
    for (const [nome, html] of Object.entries(telas)) {
      expect(html).toMatch(new RegExp(`href="/${nome}"[^>]*aria-current="page"`))
      expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    }
  })

  it('perfil mostra e-mail escapado e o papel', () => {
    const html = paginaPainel('<b>@x.com', 'x', 'desconectado', undefined, true)
    expect(html).toContain('&lt;b&gt;@x.com')
    expect(html).toContain('Administrador')
    expect(paginaPainel('a@x.com', 'x', 'desconectado')).toContain('Usuário')
  })

  it('papéis: Administrador e Usuário', () => {
    expect(paginaAdmin('ana@x.com', [])).toContain('Administrador')
    expect(paginaDashboard('ana@x.com', ind, false)).toContain('Usuário')
  })

  it('Administração só no menu de admin', () => {
    expect(telas.painel).not.toContain('href="/admin"')
    expect(telas.dashboard).not.toContain('href="/admin"')
    expect(paginaDashboard('a@x.com', ind, true)).toContain('href="/admin"')
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

describe('admin: contas', () => {
  const base = { criadaEm: new Date('2026-09-10T12:00:00Z'), conectada: false, ativa: true, papel: 'usuario' as const, vencida: false }
  const contaAtiva: ContaResumo = { ...base, id: 'c1', email: 'ana@x.com', conectada: true, grupoNome: 'Casa' }
  const contaInativa: ContaResumo = { ...base, id: 'c2', email: 'bob@x.com', ativa: false }

  it('lista as contas com e-mail e ação de alternar status', () => {
    const html = paginaAdmin('admin@x.com', [], [contaAtiva, contaInativa])
    expect(html).toContain('ana@x.com')
    expect(html).toMatch(/action="\/admin\/contas\/desativar"[\s\S]*?value="c1"/)
    expect(html).toMatch(/action="\/admin\/contas\/reativar"[\s\S]*?value="c2"/)
  })

  it('"Enviar link de redefinição" só aparece para conta ativa', () => {
    const html = paginaAdmin('admin@x.com', [], [contaAtiva, contaInativa])
    expect(html).toMatch(/value="c1"[\s\S]{0,300}Enviar link de redefinição/)
    expect(html).not.toMatch(/value="c2"[\s\S]{0,300}Enviar link de redefinição/)
  })

  it('não existe exclusão de conta na tela', () => {
    const html = paginaAdmin('admin@x.com', [], [contaAtiva])
    expect(html).not.toContain('Excluir')
    expect(html).not.toContain('/admin/contas/excluir')
  })

  it('sem contas: mensagem de lista vazia', () => {
    expect(paginaAdmin('admin@x.com', [], [])).toContain('Nenhuma conta cadastrada ainda.')
  })

  it('menu de permissões: seletor com os 3 níveis e o atual marcado', () => {
    const html = paginaAdmin('admin@x.com', [], [contaAtiva])
    expect(html).toContain('action="/admin/contas/papel"')
    expect(html).toMatch(/<option value="admin">Administrador<\/option>/)
    expect(html).toMatch(/<option value="usuario" selected>Usuário<\/option>/)
    expect(html).toMatch(/<option value="validade">Usuário com validade<\/option>/)
    const comValidade = paginaAdmin('admin@x.com', [], [{ ...contaAtiva, validadeAte: '2026-12-31' }])
    expect(comValidade).toMatch(/<option value="validade" selected>/)
    expect(comValidade).toContain('type="date"')
    expect(comValidade).toContain('value="2026-12-31"')
    expect(comValidade).toContain('Até 31/12/2026')
    expect(paginaAdmin('admin@x.com', [], [{ ...contaAtiva, papel: 'admin' }])).toMatch(/<option value="admin" selected>/)
  })

  it('conta vencida aparece marcada', () => {
    const html = paginaAdmin('admin@x.com', [], [{ ...contaAtiva, validadeAte: '2026-01-01', vencida: true }])
    expect(html).toContain('Vencida')
  })

  it('a própria conta e os admins fixos não têm seletor (só o rótulo do papel)', () => {
    const html = paginaAdmin('ana@x.com', [], [contaAtiva, contaInativa], undefined, undefined, ['bob@x.com'])
    expect(html).not.toMatch(/action="\/admin\/contas\/papel"/)
    const outra = paginaAdmin('admin@x.com', [], [contaAtiva, contaInativa], undefined, undefined, ['bob@x.com'])
    expect(outra.match(/action="\/admin\/contas\/papel"/g)).toHaveLength(1) // só a de ana; bob é fixo
  })
})

describe('paginaDashboard', () => {
  const serie: MesSerie[] = [
    { ano: 2026, mes: 8, receitas: 100000, despesas: 50000 },
    { ano: 2026, mes: 9, receitas: 150000, despesas: 25000 },
  ]
  const ind = (despesas = [{ conta: 'mercado', total: 25000 }]) => montarIndicadores(serie, { receitas: [], despesas })

  it('mostra os cartões, o gráfico, as categorias e a tabela alternativa', () => {
    const html = paginaDashboard('ana@x.com', ind(), false)
    expect(html).toContain('R$ 1.250,00') // saldo
    expect(html).toContain('+50%')
    expect(html).toContain('role="img"')
    expect(html).toContain('mercado')
    expect(html).toContain('<details')
    expect(html).toContain('href="/painel"')
  })

  it('escapa nome de categoria vindo do usuário', () => {
    const html = paginaDashboard('ana@x.com', ind([{ conta: '<img src=x onerror=alert(1)>', total: 100 }]), false)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('sem lançamentos mostra orientação em vez de gráficos', () => {
    const zerado = montarIndicadores([{ ano: 2026, mes: 9, receitas: 0, despesas: 0 }], { receitas: [], despesas: [] })
    const html = paginaDashboard('ana@x.com', zerado, false)
    expect(html).toContain('Nenhum lançamento')
    expect(html).not.toContain('role="img"')
  })

  it('nunca tem seletor de contas, nem para o admin', () => {
    expect(paginaDashboard('ana@x.com', ind(), false)).not.toContain('<select')
    expect(paginaDashboard('adm@x.com', ind(), true)).not.toContain('<select')
  })

  it('o painel ganha o link para o dashboard', () => {
    expect(paginaPainel('ana@x.com', '', 'conectar')).toContain('href="/dashboard"')
  })
})

describe('CSS compartilhado', () => {
  it('o estilo do dashboard não redefine .legenda da vitrine (regra solta só uma vez)', () => {
    const soltas = paginaEntrar().match(/(^|\n)\.legenda\{/g) ?? []
    expect(soltas).toHaveLength(1)
  })
})

describe('áreas seguras laterais (notch na horizontal)', () => {
  const html = paginaPainel('a@x.com', 'x', 'desconectado')
  it('página, menu e barra mobile respeitam a área segura esquerda/direita', () => {
    expect(html).toContain('env(safe-area-inset-left)')
    expect(html).toContain('env(safe-area-inset-right)')
    expect(html).toMatch(/\.menu\{[^}]*env\(safe-area-inset-left\)/)
    expect(html).toMatch(/\.barra-mobile\{[^}]*env\(safe-area-inset-left\)/)
  })
})

describe('página de perfil', () => {
  const ana: Conta = { id: 'c1', email: 'ana@x.com', nome: 'Ana <b>', avatarCor: 'azul', avatarIcone: 'estrela', criadaEm: new Date('2026-09-01T12:00:00Z') }

  it('formulário de identidade: nome escapado, 8 cores e 8 ícones, os atuais marcados', () => {
    const html = paginaPerfil(ana, 'usuario', 'desconectado')
    expect(html).toMatch(/<form[^>]*action="\/perfil"/)
    expect(html).toContain('Ana &lt;b&gt;')
    expect(html).not.toContain('Ana <b>')
    expect(html.match(/name="cor"/g)).toHaveLength(8)
    expect(html.match(/name="icone"/g)).toHaveLength(8)
    expect(html).toMatch(/name="cor" value="azul" checked/)
    expect(html).toMatch(/name="icone" value="estrela" checked/)
  })

  it('mostra e-mail, papel e membro desde só para leitura', () => {
    const html = paginaPerfil(ana, 'admin', 'desconectado')
    expect(html).toContain('ana@x.com')
    expect(html).toContain('Administrador')
    expect(html).toContain('01/09/2026')
    expect(html).not.toMatch(/name="email"/)
  })

  it('cartão do WhatsApp: estado, grupo e link para o painel', () => {
    const html = paginaPerfil({ ...ana, grupoNome: 'Casa <i>' }, 'usuario', 'conectado')
    expect(html).toContain('Conectado')
    expect(html).toContain('Casa &lt;i&gt;')
    expect(html).toContain('href="/painel"')
  })

  it('segurança: troca de senha e sair dos outros aparelhos', () => {
    const html = paginaPerfil(ana, 'usuario', 'desconectado')
    expect(html).toMatch(/<form[^>]*action="\/perfil\/senha"/)
    for (const n of ['atual', 'nova', 'confirmacao']) expect(html).toContain(`name="${n}"`)
    expect(html).toMatch(/<form[^>]*action="\/perfil\/sair-aparelhos"/)
  })

  it('mensagem de erro e de sucesso', () => {
    expect(paginaPerfil(ana, 'usuario', 'desconectado', { erro: 'Senha atual incorreta.' })).toContain('Senha atual incorreta.')
    expect(paginaPerfil(ana, 'usuario', 'desconectado', { ok: 'Perfil salvo.' })).toMatch(/class="aviso ok"[^>]*>[\s\S]*Perfil salvo\./)
  })

  it('o menu de todas as telas usa o avatar e o nome escolhidos', () => {
    const perfil = { nome: 'Ana <b>', cor: 'roxo', icone: 'chama' }
    const telas = [paginaPainel('ana@x.com', 'x', 'desconectado', undefined, false, perfil), paginaPerfil(ana, 'usuario', 'desconectado')]
    for (const html of telas) expect(html).toMatch(/class="avatar av-(roxo|azul)"/)
    expect(telas[0]).toContain('Ana &lt;b&gt;')
    expect(telas[0]).toContain('href="/perfil"')
  })

  it('cor fora da lista cai no padrão (nada vira classe CSS arbitrária)', () => {
    const html = paginaPainel('ana@x.com', 'x', 'desconectado', undefined, false, { cor: 'x" onclick="1' })
    expect(html).not.toContain('onclick')
    expect(html).toContain('av-vermelho')
  })
})

describe('layout fluido (largura total, sem centralizar)', () => {
  const ind = montarIndicadores([{ ano: 2026, mes: 9, receitas: 100000, despesas: 25000 }], { receitas: [], despesas: [{ conta: 'mercado', total: 25000 }] })
  const telas = {
    painel: paginaPainel('a@x.com', 'x', 'desconectado'),
    dashboard: paginaDashboard('a@x.com', ind, false),
    admin: paginaAdmin('a@x.com', []),
    perfil: paginaPerfil(conta, 'usuario', 'desconectado'),
  }

  it('o conteúdo não é mais limitado a 560/880px nem centralizado', () => {
    const css = telas.painel
    expect(css).not.toContain('max-width:560px;margin:0 auto')
    expect(css).not.toContain('.pagina.larga')
    expect(css).toContain('max-width:1280px')
  })

  it('toda tela logada tem cabeçalho padrão com h1 e a viewport cobre a área segura', () => {
    for (const html of Object.values(telas)) {
      expect(html).toMatch(/<header class="topo-tela"><h1>[^<]+<\/h1>/)
      expect(html).toContain('viewport-fit=cover')
    }
  })

  it('tokens de espaçamento e sombras no :root', () => {
    expect(telas.painel).toMatch(/--e4:16px/)
    expect(telas.painel).toMatch(/--sombra2:/)
  })
})

describe('grades por tela', () => {
  const ind = montarIndicadores([{ ano: 2026, mes: 9, receitas: 100000, despesas: 25000 }], { receitas: [], despesas: [{ conta: 'mercado', total: 25000 }] })
  const vazio = montarIndicadores([{ ano: 2026, mes: 9, receitas: 0, despesas: 0 }], { receitas: [], despesas: [] })

  it('dashboard: gráfico (7) ao lado das categorias (5)', () => {
    const html = paginaDashboard('a@x.com', ind, false)
    expect(html).toMatch(/class="grade duas"[\s\S]*class="cartao c7"[\s\S]*Últimos[\s\S]*class="cartao c5"[\s\S]*Despesas por categoria/)
  })

  it('dashboard vazio: estado vazio com ícone e o texto de antes', () => {
    const html = paginaDashboard('a@x.com', vazio, false)
    expect(html).toMatch(/class="vazio"[^>]*><svg[^>]*aria-hidden="true"/)
    expect(html).toContain('Nenhum lançamento nos últimos 6 meses')
  })

  it('perfil: identidade (6) e as demais seções (6)', () => {
    const html = paginaPerfil(conta, 'usuario', 'desconectado')
    expect(html).toMatch(/class="grade duas"[\s\S]*class="cartao c6"[\s\S]*Identidade[\s\S]*class="pilha c6"[\s\S]*Segurança/)
  })

  it('admin: novo convite (5) ao lado de convites e contas (7); formulários e textos de antes', () => {
    const html = paginaAdmin('a@x.com', [])
    expect(html).toMatch(/class="grade duas"[\s\S]*class="cartao c5"[\s\S]*Novo convite[\s\S]*class="pilha c7"[\s\S]*Convites[\s\S]*Contas/)
    expect(html).toContain('Nenhum convite')
    expect(html).toMatch(/<form[^>]*action="\/admin\/convites"/)
  })
})

describe('celular', () => {
  const html = paginaPainel('a@x.com', 'x', 'desconectado')
  it('véu da gaveta esmaece (opacity/visibility) em vez de aparecer de repente', () => {
    expect(html).toMatch(/\.veu\{display:block;[^}]*opacity:0;visibility:hidden/)
    expect(html).toMatch(/data-gaveta=aberta\] \.veu\{opacity:1;visibility:visible\}/)
  })
  it('barra superior respeita a área segura do aparelho', () => {
    expect(html).toContain('env(safe-area-inset-top)')
  })
})

describe('movimento e acabamento', () => {
  const html = paginaPainel('a@x.com', 'x', 'desconectado')
  it('transição nativa entre páginas, com o menu parado', () => {
    expect(html).toContain('@view-transition{navigation:auto}')
    expect(html).toContain('.menu{view-transition-name:menu}')
  })
  it('entrada em cascata e barras que crescem', () => {
    expect(html).toContain('@keyframes entra')
    expect(html).toContain('@keyframes cresce')
  })
  it('movimento reduzido desliga animações e transições de página', () => {
    expect(html).toMatch(/prefers-reduced-motion:reduce\)\{[^@]*::view-transition-old\(\*\)/)
  })
  it('item ativo do menu tem barra de destaque', () => {
    expect(html).toContain('.item[aria-current=page]::before')
  })
})

describe('página de contas correntes', () => {
  const lista: ContaCorrenteComSaldo[] = [
    { id: 'a', apelido: 'principal', nome: 'Principal', saldoInicial: 0, saldo: 1500, favorita: true, ativa: true },
    { id: 'b', apelido: 'nubank', nome: '<b>Nubank</b>', saldoInicial: 0, saldo: -300, favorita: false, ativa: true },
    { id: 'c', apelido: 'antiga', nome: 'Antiga', saldoInicial: 0, saldo: 0, favorita: false, ativa: false },
  ]
  const html = paginaContasCorrentes('a@x.com', false, lista, {})

  it('lista contas com apelido, saldo, favorita e desativada; nome escapado', () => {
    expect(html).toContain('@principal')
    expect(html).toContain('R$ 15,00')
    expect(html).toContain('-R$ 3,00')
    expect(html).toContain('Favorita')
    expect(html).toContain('Desativada')
    expect(html).toContain('&lt;b&gt;Nubank&lt;/b&gt;')
    expect(html).not.toContain('<b>Nubank</b>')
  })

  it('a favorita não tem botão de desativar; as outras têm; desativada tem reativar', () => {
    expect(html.match(/action="\/contas-correntes\/desativar"/g)).toHaveLength(1)
    expect(html.match(/action="\/contas-correntes\/reativar"/g)).toHaveLength(1)
    expect(html.match(/action="\/contas-correntes\/favoritar"/g)).toHaveLength(1) // só a ativa que não é favorita
  })

  it('formulário de criar com rótulos; menu marca a página atual', () => {
    expect(html).toMatch(/<label[^>]*for="apelido"/)
    expect(html).toMatch(/<label[^>]*for="nome"/)
    expect(html).toMatch(/<label[^>]*for="saldo"/)
    expect(html).toContain('action="/contas-correntes"')
    expect(html).toMatch(/href="\/contas-correntes" aria-current="page"/)
  })

  it('mostra erro e aviso', () => {
    expect(paginaContasCorrentes('a@x.com', false, lista, { erro: 'Apelido inválido.' })).toContain('Apelido inválido.')
    expect(paginaContasCorrentes('a@x.com', false, lista, { ok: 'Conta criada.' })).toContain('Conta criada.')
  })
})

describe('dashboard: seletor de conta', () => {
  const ind = montarIndicadores([{ ano: 2026, mes: 9, receitas: 100000, despesas: 25000 }], { receitas: [], despesas: [{ conta: 'mercado', total: 25000 }] })
  const contasSel = [{ apelido: 'principal', nome: 'Principal' }, { apelido: 'nubank', nome: 'Nubank' }]
  it('com 2+ contas mostra o seletor (formulário GET), com "Todas" e a selecionada marcada', () => {
    const html = paginaDashboard('a@x.com', ind, false, undefined, contasSel, 'nubank')
    expect(html).toContain('<form method="get" action="/dashboard"')
    expect(html).toContain('<option value="">Todas as contas</option>')
    expect(html).toContain('<option value="nubank" selected>Nubank</option>')
    expect(html).toContain('· Nubank') // e o nome aparece no subtítulo
  })
  it('com uma conta só, nada de seletor', () => {
    expect(paginaDashboard('a@x.com', ind, false, undefined, [contasSel[0]])).not.toContain('<select')
    expect(paginaDashboard('a@x.com', ind, false)).not.toContain('<select')
  })
})
