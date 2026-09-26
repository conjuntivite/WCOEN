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
