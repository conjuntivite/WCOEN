import type { Conta } from './contas'
import type { Aviso, Visao } from './sessoes'

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTIDADES[c])

// --- identidade visual ---------------------------------------------------
// Sem fontes nem imagens externas (a CSP só permite o próprio site): pilha do sistema e SVG inline.

const ESTILO = `
:root{color-scheme:light dark;--fundo:#f3f7f5;--cartao:#fff;--texto:#14201c;--suave:#4b5b55;--borda:#d8e2dd;--marca:#0b7a5a;--marca-forte:#095f46;--sobre-marca:#fff;--marca-suave:#e2f3ec;--erro:#b42318;--erro-suave:#fdeceb;--alerta:#9a5b00;--alerta-suave:#fdf3dc;--foco:#0b7a5a;--sombra:0 1px 2px rgba(16,40,32,.06),0 8px 24px rgba(16,40,32,.07)}
@media (prefers-color-scheme:dark){:root{--fundo:#0c1310;--cartao:#141e1a;--texto:#e8f1ed;--suave:#9db1a8;--borda:#25342e;--marca:#2fbf83;--marca-forte:#5fd7a3;--sobre-marca:#04231a;--marca-suave:#12332a;--erro:#f97066;--erro-suave:#33191a;--alerta:#f5b544;--alerta-suave:#33280f;--foco:#5fd7a3;--sombra:none}}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--texto);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 8px;font-weight:700;letter-spacing:-.01em}
h2{font-size:1.2rem;line-height:1.3;margin:0;font-weight:650}
p{margin:0 0 12px}a{color:var(--marca);font-weight:600}a:hover{color:var(--marca-forte)}
:focus-visible{outline:3px solid var(--foco);outline-offset:2px;border-radius:6px}
.pular{position:absolute;left:-999px;top:8px;background:var(--cartao);padding:8px 12px;border-radius:8px;z-index:10}.pular:focus{left:8px}
.sub{color:var(--suave);font-size:.94rem}
.ic{width:1.15em;height:1.15em;flex:none;vertical-align:-.2em}
.marca{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:1.25rem;letter-spacing:.02em;color:inherit;text-decoration:none}
.logo{width:36px;height:36px;flex:none}
/* entrar / cadastro */
.auth{min-height:100vh}
.vitrine{background:linear-gradient(160deg,#0b7a5a 0%,#064434 100%);color:#fff;padding:24px 20px 28px}
.vitrine .tagline{margin:10px 0 0;color:#d6f0e5;font-size:.98rem}
.vitrine .extra{display:none}
.lado-form{padding:20px 16px 40px;display:flex;justify-content:center;align-items:flex-start}
.lado-form>div{width:100%;max-width:420px}
.cartao{background:var(--cartao);border:1px solid var(--borda);border-radius:16px;padding:22px;box-shadow:var(--sombra)}
.cartao h2{margin-bottom:4px}
.campo{margin:14px 0}
label{display:block;font-size:.9rem;font-weight:600;margin-bottom:6px}
input,select{display:block;width:100%;min-height:48px;padding:10px 14px;border:1.5px solid var(--borda);border-radius:12px;background:var(--fundo);color:var(--texto);font:inherit}
input:hover,select:hover{border-color:var(--suave)}
input[aria-invalid=true]{border-color:var(--erro)}
.erro-campo{display:flex;gap:6px;align-items:flex-start;color:var(--erro);font-size:.88rem;font-weight:600;margin:6px 0 0}
.aviso{display:flex;gap:8px;align-items:flex-start;background:var(--erro-suave);color:var(--erro);border-radius:12px;padding:10px 12px;font-size:.93rem;font-weight:600;margin:12px 0}
.aviso.espera{background:var(--alerta-suave);color:var(--alerta)}
.btn{display:inline-flex;justify-content:center;align-items:center;gap:8px;width:100%;min-height:48px;margin-top:14px;padding:10px 18px;border:0;border-radius:12px;background:var(--marca);color:var(--sobre-marca);font:inherit;font-weight:700;cursor:pointer;transition:background-color .15s,transform .15s}
.btn:hover{background:var(--marca-forte)}.btn:active{transform:scale(.99)}
.btn.sec{background:transparent;color:var(--suave);border:1.5px solid var(--borda);font-weight:600}
.btn.sec:hover{background:var(--marca-suave);color:var(--texto)}
.btn.pequeno{width:auto;margin:0;min-height:44px;padding:8px 14px}
.rodape-form{margin:16px 0 0;text-align:center;color:var(--suave);font-size:.94rem}
/* prévia do bot */
.balao{background:#fff;color:#14201c;border-radius:4px 16px 16px 16px;padding:14px 16px;font-size:.92rem;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:320px}
.balao p{margin:0 0 8px}.balao hr{border:0;border-top:1px solid #d8e2dd;margin:8px 0}
.legenda{color:#d6f0e5;font-size:.88rem;margin-top:10px}
/* painel */
.pagina{max-width:560px;margin:0 auto;padding:16px}
.topo{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0 16px}
.topo .marca{color:var(--texto)}
.usuario{display:flex;align-items:center;gap:10px;min-width:0}.usuario form{margin:0}
.email{color:var(--suave);font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
.passos{display:flex;gap:6px;list-style:none;margin:0 0 20px;padding:0}
.passos li{flex:1;display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--suave);font-weight:600;padding:8px 10px;border-radius:12px;background:var(--fundo)}
.passos .num{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:1.5px solid var(--borda);font-size:.8rem;flex:none}
.passos .atual{background:var(--marca-suave);color:var(--texto)}.passos .atual .num{background:var(--marca);border-color:var(--marca);color:var(--sobre-marca)}
.passos .feito{color:var(--texto)}.passos .feito .num{background:var(--marca-suave);border-color:var(--marca);color:var(--marca)}
.passos .num .ic{width:14px;height:14px}
.cabeca{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;padding:4px 10px;border-radius:999px;background:var(--fundo);color:var(--suave);white-space:nowrap}
.chip .ponto{width:8px;height:8px;border-radius:50%;background:currentColor}
.chip-ok{background:var(--marca-suave);color:var(--marca)}.chip-espera{background:var(--alerta-suave);color:var(--alerta)}
.qr{background:#fff;border:1px solid var(--borda);border-radius:16px;padding:12px;margin:14px auto;max-width:300px}.qr svg{display:block;width:100%;height:auto}
.instrucoes{padding-left:1.2rem;margin:8px 0;color:var(--suave);font-size:.94rem}.instrucoes li{margin:2px 0}
.codigo{font:700 2rem/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:center;letter-spacing:.15em;background:var(--marca-suave);border-radius:12px;padding:14px;margin:12px 0}
.carregando{display:flex;align-items:center;gap:12px;color:var(--suave);padding:8px 0}
.giro{width:22px;height:22px;border-radius:50%;border:3px solid var(--borda);border-top-color:var(--marca);animation:giro .9s linear infinite}
@keyframes giro{to{transform:rotate(360deg)}}
.pronto{display:flex;align-items:center;gap:10px;color:var(--marca)}.pronto .ic{width:1.6em;height:1.6em}
.grupo{margin:8px 0 14px}.grupo strong{color:var(--texto)}
.comandos{list-style:none;margin:8px 0 4px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:8px}
.comandos li{background:var(--fundo);border:1px solid var(--borda);border-radius:12px;padding:10px 12px;min-width:0}
.comandos .rot{display:block;color:var(--suave);font-size:.8rem;margin-bottom:2px}
code{font:600 .92rem ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}
details{margin-top:14px}summary{cursor:pointer;color:var(--suave);font-weight:600;min-height:44px;display:flex;align-items:center}
@media (min-width:860px){
.auth{display:grid;grid-template-columns:1.05fr 1fr}
.vitrine{position:sticky;top:0;height:100vh;padding:48px 56px;display:flex;flex-direction:column;justify-content:center}
.vitrine .extra{display:block;margin-top:40px}
.vitrine h1{font-size:2.2rem}
.lado-form{align-items:center;padding:48px}
}
@media (max-width:420px){.comandos{grid-template-columns:1fr}.email{display:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}.giro{border-top-color:var(--borda)}}
`

const ICONES = {
  celular: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  alerta: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  troca: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>',
}
const ic = (nome: keyof typeof ICONES) =>
  `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome]}</svg>`

// balão de conversa com uma moeda dentro
const LOGO = `<svg class="logo" aria-hidden="true" viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="var(--marca)"/><path d="M11 12.5A3.5 3.5 0 0 1 14.5 9h11a3.5 3.5 0 0 1 3.5 3.5v8a3.5 3.5 0 0 1-3.5 3.5H21l-5 4.5V24h-1.5A3.5 3.5 0 0 1 11 20.5z" fill="var(--sobre-marca)"/><circle cx="20" cy="16.5" r="4.2" fill="none" stroke="var(--marca)" stroke-width="2"/><path d="M20 14.6v3.8" stroke="var(--marca)" stroke-width="2" stroke-linecap="round"/></svg>`
const marca = (href = '/') => `<a class="marca" href="${href}" aria-label="WCOEN, início">${LOGO}<span>WCOEN</span></a>`

const layout = (titulo: string, corpo: string, script = '') =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(titulo)} · WCOEN</title><style>${ESTILO}</style></head><body><a class="pular" href="#conteudo">Pular para o conteúdo</a>${corpo}${script}</body></html>`

// exemplo real do que o bot responde no grupo (conteúdo do WhatsApp, por isso mantém os emojis)
const BALAO = `<div class="balao" role="img" aria-label="Exemplo de mensagem do bot: balancete do dia com saldo de R$ 404,10"><div aria-hidden="true"><p><b>📊 BALANCETE DO DIA</b><br><i>15/09/2026</i></p><hr><p>🟢 Receitas<br><b>R$ 450,00</b></p><p>🔴 Despesas<br><b>R$ 45,90</b></p><p style="margin:0">💚 <b>SALDO</b><br><b>R$ 404,10</b></p></div></div><p class="legenda">Assim o bot responde no seu grupo.</p>`

const telaAuth = (titulo: string, conteudo: string) =>
  layout(
    titulo,
    `<div class="auth"><aside class="vitrine">${marca()}<p class="tagline">Seu controle financeiro pelo WhatsApp</p><div class="extra"><h1>Lance no grupo. Acompanhe no automático.</h1><p class="tagline">Despesas e receitas numa mensagem, com balancete, extrato e auditoria na mesma conversa.</p><div style="margin-top:28px">${BALAO}</div></div></aside><main class="lado-form" id="conteudo"><div>${conteudo}</div></main></div>`,
  )

type CampoDef = { nome: string; rotulo: string; tipo?: string; valor?: string; extra?: string; erro?: string }
const campo = ({ nome, rotulo, tipo = 'text', valor = '', extra = '', erro }: CampoDef) =>
  `<div class="campo"><label for="${nome}">${rotulo}</label><input id="${nome}" name="${nome}" type="${tipo}" required ${valor ? `value="${esc(valor)}" ` : ''}${erro ? `aria-invalid="true" aria-describedby="erro-${nome}" ` : ''}${extra}>${erro ? `<p class="erro-campo" id="erro-${nome}" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : ''}</div>`

const aviso = (texto?: string, classe = '') => (texto ? `<div class="aviso ${classe}" role="alert">${ic('alerta')}<span>${esc(texto)}</span></div>` : '')

export const paginaEntrar = (erro?: string, email = '') =>
  telaAuth(
    'Entrar',
    `<section class="cartao"><h2>Entrar</h2><p class="sub">Acesse seu painel.</p>${aviso(erro)}<form method="post" action="/entrar">${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: email, extra: 'autocomplete="username"' })}${campo({ nome: 'senha', rotulo: 'Senha', tipo: 'password', extra: 'autocomplete="current-password"' })}<button class="btn">Entrar</button></form></section><p class="rodape-form">Ainda não tem conta? <a href="/cadastro">Cadastre-se</a></p>`,
  )

export type CampoCadastro = 'email' | 'senha' | 'convite'

export const paginaCadastro = (erro?: string, comErro?: CampoCadastro, email = '') =>
  telaAuth(
    'Criar conta',
    `<section class="cartao"><h2>Criar conta</h2><p class="sub">Você precisa de um código de convite.</p><form method="post" action="/cadastro">${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: email, extra: 'autocomplete="username"', erro: comErro === 'email' ? erro : undefined })}${campo({ nome: 'senha', rotulo: 'Senha (mínimo 8 caracteres)', tipo: 'password', extra: 'minlength="8" autocomplete="new-password"', erro: comErro === 'senha' ? erro : undefined })}${campo({ nome: 'convite', rotulo: 'Código de convite', extra: 'autocomplete="off"', erro: comErro === 'convite' ? erro : undefined })}${comErro ? '' : aviso(erro)}<button class="btn">Criar conta</button></form></section><p class="rodape-form">Já tem conta? <a href="/entrar">Entrar</a></p>`,
  )

// --- painel --------------------------------------------------------------

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
    `<div class="pagina"><header class="topo">${marca('/painel')}<div class="usuario"><span class="email" title="${esc(email)}">${esc(email)}</span><form method="post" action="/sair"><button class="btn sec pequeno">${ic('sair')}Sair</button></form></div></header><main id="conteudo">${aviso(erro)}<div class="cartao" id="estado" data-passo="${esc(passo)}" aria-live="polite">${fragmento}</div></main></div>`,
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

const NOMES_PASSOS = ['Conectar', 'Grupo', 'Pronto']
const passos = (atual: 1 | 2 | 3) =>
  `<ol class="passos" aria-label="Progresso da configuração">${NOMES_PASSOS.map((n, i) => {
    const num = i + 1
    return `<li class="${num < atual ? 'feito' : num === atual ? 'atual' : ''}"${num === atual ? ' aria-current="step"' : ''}><span class="num">${num < atual ? ic('check') : num}</span><span>${n}</span></li>`
  }).join('')}</ol>`

const CHIPS: Record<Visao['estado'], [string, string]> = {
  desconectado: ['', 'Desconectado'],
  conectando: ['chip-espera', 'Conectando'],
  aguardando_qr: ['chip-espera', 'Aguardando leitura'],
  conectado: ['chip-ok', 'Conectado'],
}
const chip = (estado: Visao['estado']) => `<span class="chip ${CHIPS[estado][0]}"><span class="ponto"></span>${CHIPS[estado][1]}</span>`

const botao = (acao: string, rotulo: string, classe = '', icone = '') => `<form method="post" action="${acao}"><button class="btn ${classe}">${icone}${rotulo}</button></form>`

const seletorGrupo = (grupos: DadosFragmento['grupos'], atual?: string) =>
  grupos.length
    ? `<form method="post" action="/painel/grupo"><div class="campo"><label for="grupo">Grupo do WhatsApp</label><select id="grupo" name="grupo" required>${grupos.map((g) => `<option value="${esc(g.id)}"${g.id === atual ? ' selected' : ''}>${esc(g.nome)}</option>`).join('')}</select></div><button class="btn">Usar este grupo</button></form>`
    : '<p class="sub">Nenhum grupo encontrado. Crie um grupo no WhatsApp e recarregue a página.</p>'

const COMANDOS: [string, string][] = [
  ['Lançar despesa', 'mercado 45,90'],
  ['Lançar receita', '+ 70 plantão'],
  ['Movimento de hoje', 'balancete'],
  ['Todos os lançamentos', 'extrato'],
  ['Corrigir o último', 'desfazer'],
  ['Ver todos os comandos', 'ajuda'],
]

// o que muda ao vivo dentro do painel (renderizado também no SSE)
export function fragmentoPainel({ visao: v, conta, grupos, qrSvg }: DadosFragmento): string {
  const cabeca = (titulo: string) => `<div class="cabeca"><h2>${titulo}</h2>${chip(v.estado)}</div>`

  if (v.estado === 'desconectado') {
    return `${passos(1)}${aviso(v.aviso ? AVISOS[v.aviso] : undefined)}${cabeca('Conecte seu WhatsApp')}<p class="sub">Você vai vincular este WhatsApp como um aparelho conectado. O bot só responde no grupo que você escolher.</p>${botao('/painel/conectar', 'Conectar WhatsApp', '', ic('celular'))}`
  }
  if (v.estado === 'conectando') {
    return `${passos(1)}${cabeca('Conectando…')}<div class="carregando"><span class="giro" aria-hidden="true"></span><span>Aguarde alguns segundos.</span></div>`
  }
  if (v.estado === 'aguardando_qr') {
    const pareamento = v.codigo
      ? `<p class="sub">No WhatsApp, abra <b>Aparelhos conectados → Conectar com número de telefone</b> e digite:</p><p class="codigo">${esc(`${v.codigo.slice(0, 4)}-${v.codigo.slice(4)}`)}</p>`
      : `<details><summary>Estou no celular: usar código em vez do QR</summary><form method="post" action="/painel/parear">${campo({ nome: 'telefone', rotulo: 'Seu número com DDI e DDD', tipo: 'tel', extra: 'placeholder="5511999999999" inputmode="numeric" autocomplete="tel"' })}<button class="btn sec">Gerar código</button></form></details>`
    return `${passos(1)}${cabeca('Escaneie o QR')}<ol class="instrucoes"><li>Abra o WhatsApp no celular</li><li>Toque em <b>Aparelhos conectados</b></li><li>Toque em <b>Conectar um aparelho</b> e aponte para o QR</li></ol><div class="qr" role="img" aria-label="QR Code para conectar o WhatsApp">${qrSvg ?? ''}</div>${pareamento}`
  }
  // conectado
  if (!conta.grupoId) {
    return `${passos(2)}${cabeca('Escolha o grupo')}<p class="sub">O bot vai ler e responder só nesse grupo.</p>${seletorGrupo(grupos)}${botao('/painel/desconectar', 'Desconectar', 'sec')}`
  }
  return `${passos(3)}<div class="cabeca"><h2 class="pronto">${ic('check')}Tudo pronto</h2>${chip(v.estado)}</div><p class="grupo">Grupo: <strong>${esc(conta.grupoNome ?? conta.grupoId)}</strong></p><p class="sub">Digite no grupo:</p><ul class="comandos">${COMANDOS.map(([rot, cmd]) => `<li><span class="rot">${rot}</span><code>${cmd}</code></li>`).join('')}</ul><details><summary>${ic('troca')}&nbsp;Trocar grupo</summary>${seletorGrupo(grupos, conta.grupoId)}</details>${botao('/painel/desconectar', 'Desconectar', 'sec')}`
}
