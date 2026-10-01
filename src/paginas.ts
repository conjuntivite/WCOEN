import { AVATAR_CORES, AVATAR_ICONES, type Conta, type ContaResumo, type Papel, type Perfil } from './contas'
import type { Convite } from './convites'
import type { Aviso, Visao } from './sessoes'
import { rotuloMesCurto, svgTendencia, type Indicadores } from './dashboard'
import { formatBRL } from './money'

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTIDADES[c])

// --- identidade visual ---------------------------------------------------
// Sem fontes nem imagens externas (a CSP só permite o próprio site): pilha do sistema e SVG inline.

const ESCURO = '--fundo:#0d0a0a;--cartao:#171213;--texto:#f3eaea;--suave:#b5a2a4;--borda:#322627;--marca:#ff4444;--marca-forte:#ff7a7a;--sobre-marca:#1a0505;--marca-suave:#33191a;--erro:#f97066;--erro-suave:#33191a;--alerta:#f5b544;--alerta-suave:#33280f;--foco:#ff7a7a;--receita:#4ade80;--despesa:#fbbf24;--sombra:none;--sombra2:0 10px 30px rgba(0,0,0,.5)'

const ESTILO = `
:root{color-scheme:light dark;--fundo:#f8f5f4;--cartao:#fff;--texto:#1a1213;--suave:#5e5052;--borda:#e6dcdb;--marca:#d10f0f;--marca-forte:#a80b0b;--sobre-marca:#fff;--marca-suave:#fbe9e8;--erro:#b42318;--erro-suave:#fdeceb;--alerta:#9a5b00;--alerta-suave:#fdf3dc;--foco:#d10f0f;--receita:#0f7a43;--despesa:#b45309;--sombra:0 1px 2px rgba(40,10,10,.06),0 8px 24px rgba(40,10,10,.07);--e1:4px;--e2:8px;--e3:12px;--e4:16px;--e5:24px;--e6:32px;--raio:16px;--sombra2:0 2px 4px rgba(40,10,10,.08),0 14px 32px rgba(40,10,10,.14);--ease:cubic-bezier(.2,.8,.2,1)}
@media (prefers-color-scheme:dark){:root:not([data-tema=light]){${ESCURO}}}
:root[data-tema=dark]{color-scheme:dark;${ESCURO}}:root[data-tema=light]{color-scheme:light}
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
.logo{width:36px;height:auto;flex:none}
.logo-cheia{display:block;width:min(280px,80%);height:auto}
/* entrar / cadastro */
.auth{min-height:100vh}
.vitrine{background:linear-gradient(160deg,#2a0808 0%,#0a0505 100%);color:#fff;padding:24px 20px 28px}
.vitrine .tagline{margin:10px 0 0;color:#f0d4d4;font-size:.98rem}
.vitrine .extra{display:none}
.lado-form{padding:20px 16px 40px;display:flex;justify-content:center;align-items:flex-start}
.lado-form>div{width:100%;max-width:420px}
.cartao{background:var(--cartao);border:1px solid var(--borda);border-radius:var(--raio);padding:22px;box-shadow:var(--sombra)}
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
.legenda{color:#f0d4d4;font-size:.88rem;margin-top:10px}
/* painel */
.pagina{max-width:1280px;padding:var(--e4) var(--e4) calc(var(--e6) + env(safe-area-inset-bottom))}
.pagina>main{display:grid;gap:var(--e4);align-content:start}.pagina>main>.aviso{margin:0}
.topo-tela h1{margin:0;font-size:clamp(1.5rem,1.2rem + 1vw,2rem)}.topo-tela .sub{margin:var(--e1) 0 0}
.grade{display:grid;gap:var(--e4);align-items:start}
.cartao,.kpi,.comandos li,.menu,input,select{transition:background-color .25s,border-color .25s,color .25s,box-shadow .2s var(--ease),transform .2s var(--ease)}
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
/* menu lateral */
.app{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh;transition:grid-template-columns .2s}
.menu{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:10px;padding:14px 12px;background:var(--cartao);border-right:1px solid var(--borda)}
.menu-topo{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px}
.menu nav{display:flex;flex-direction:column;gap:4px;flex:1}
.menu-base{display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--borda);padding-top:10px}
.item,.icone{display:flex;align-items:center;gap:12px;width:100%;min-height:44px;padding:8px 12px;border:0;border-radius:12px;background:transparent;color:var(--suave);font:inherit;font-weight:600;text-align:left;text-decoration:none;cursor:pointer;transition:background-color .15s,color .15s}
.icone{width:44px;padding:0;justify-content:center;flex:none}
.item:hover,.icone:hover{background:var(--marca-suave);color:var(--texto)}
.item[aria-current=page]{background:var(--marca-suave);color:var(--marca)}
.item .ic,.icone .ic{width:1.3em;height:1.3em}
.ic-sol{display:none}:root[data-tema=dark] .ic-sol{display:inline}:root[data-tema=dark] .ic-lua{display:none}
.menu .marca{font-size:1.1rem;color:var(--texto);min-width:0}
.perfil{position:relative;margin:0}.perfil summary{list-style:none;padding:8px 12px}.perfil summary::-webkit-details-marker{display:none}
.avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--marca);color:var(--sobre-marca);font-size:.85rem;font-weight:700;flex:none}
.perfil-menu{position:absolute;bottom:calc(100% + 6px);left:0;min-width:240px;max-width:300px;padding:14px;background:var(--cartao);border:1px solid var(--borda);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.18);z-index:20}
.perfil-menu p{margin:0}.perfil-email{font-weight:600;overflow-wrap:anywhere}.perfil-menu form{margin-top:10px}
.barra-mobile,.veu{display:none}
.conteudo{min-width:0}
@media (min-width:860px){
html[data-menu=estreito] .app{grid-template-columns:72px minmax(0,1fr)}
html[data-menu=estreito] .rotulo,html[data-menu=estreito] .menu .marca span{display:none}
html[data-menu=estreito] .menu-topo{flex-direction:column;justify-content:center}
html[data-menu=estreito] .item{justify-content:center;padding:8px}
}
@media (max-width:859px){
.app{display:block}
.barra-mobile{display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:10;padding:6px 10px;background:var(--cartao);border-bottom:1px solid var(--borda)}
.barra-mobile .item{width:44px;padding:0;justify-content:center}
.menu{position:fixed;left:0;top:0;bottom:0;width:264px;z-index:30;transform:translateX(-100%);visibility:hidden;transition:transform .2s,visibility .2s}
#menu-alternar{display:none}
html[data-gaveta=aberta] .menu{transform:none;visibility:visible}
html[data-gaveta=aberta] .veu{display:block;position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.45)}
}
/* avatar e perfil */
.av-vermelho{background:#d10f0f}.av-laranja{background:#c2410c}.av-amarelo{background:#a16207}.av-verde{background:#15803d}.av-azul{background:#1d4ed8}.av-roxo{background:#7e22ce}.av-rosa{background:#be185d}.av-cinza{background:#52525b}
.avatar[class*=av-]{color:#fff}.avatar .ic{width:15px;height:15px}.avatar.neutro{background:var(--marca-suave);color:var(--texto)}
.perfil-menu a.item{margin-top:10px;padding-left:0}
.pilha{display:grid;gap:16px}
.dados{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:12px 0 0}.dados dt{color:var(--suave)}.dados dd{margin:0;overflow-wrap:anywhere}
fieldset.opcoes{border:0;padding:0;margin:14px 0}fieldset.opcoes legend{font-size:.9rem;font-weight:600;margin-bottom:6px;padding:0}
.op{position:relative;display:inline-block;margin:0 6px 6px 0;cursor:pointer}
.op input{position:absolute;opacity:0;width:1px;height:1px;min-height:0;padding:0;border:0}
.op .avatar{width:40px;height:40px;font-size:1rem}.op .avatar .ic{width:20px;height:20px}
.op input:checked+.avatar{outline:3px solid var(--foco);outline-offset:2px}.op input:focus-visible+.avatar{outline:3px dashed var(--texto);outline-offset:2px}
.so-leitor{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.aviso.ok{background:var(--marca-suave);color:var(--receita)}
/* admin */
.convites{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.convite{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--borda);border-radius:12px}
.convite>div:first-child{flex:1;min-width:160px}
.convite form{margin:0}
@media (min-width:860px){
.auth{display:grid;grid-template-columns:1.05fr 1fr}
.vitrine{position:sticky;top:0;height:100vh;padding:48px 56px;display:flex;flex-direction:column;justify-content:center}
.vitrine .extra{display:block;margin-top:40px}
.vitrine h1{font-size:2.2rem}
.lado-form{align-items:center;padding:48px}
}
/* dashboard */
.dash{display:grid;gap:16px}
.kpis{display:grid;gap:12px;grid-template-columns:1fr}
.kpi{background:var(--cartao);border:1px solid var(--borda);border-radius:var(--raio);padding:16px;box-shadow:var(--sombra)}
.kpi .rot{color:var(--suave);font-size:.9rem}.kpi .num{white-space:nowrap;font-size:1.6rem;font-weight:700;letter-spacing:-.01em}
.var{display:inline-flex;align-items:center;gap:4px;font-size:.88rem;font-weight:600}.var.bom{color:var(--receita)}.var.ruim{color:var(--erro)}.var.neutro{color:var(--suave)}
.grafico{display:block;width:100%;max-width:560px;height:auto;margin:0 auto}
.grafico .b-rec{fill:var(--receita)}.grafico .b-desp{fill:url(#hachura);stroke:var(--despesa);stroke-width:1.5}
.grafico .h-fundo{fill:var(--cartao)}.grafico .h-traco{stroke:var(--despesa);stroke-width:3}
.grafico .val,.grafico .eixo{fill:var(--texto);font-size:10px}.grafico .eixo{fill:var(--suave);font-size:11px}.grafico .base{stroke:var(--borda)}
.dash .legenda{display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 0;padding:0;list-style:none;font-size:.88rem;color:var(--suave)}
.dash .legenda i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}.dash .legenda .l-rec{background:var(--receita)}.dash .legenda .l-desp{border:1.5px solid var(--despesa);background:repeating-linear-gradient(45deg,var(--despesa) 0 2px,transparent 2px 5px)}
.cats{list-style:none;margin:0;padding:0;display:grid;gap:12px}.cats li{display:grid;grid-template-columns:1fr auto;gap:2px 12px}.cats .nome{overflow-wrap:anywhere}.cats .valor{font-variant-numeric:tabular-nums;font-weight:600}
.trilho{grid-column:1/-1;height:8px;background:var(--borda);border-radius:99px;overflow:hidden}.trilho div{height:100%;background:var(--despesa);border-radius:99px}
.dash details{margin-top:12px;font-size:.9rem}.dash summary{cursor:pointer;color:var(--suave)}.dash table{width:100%;border-collapse:collapse;margin-top:8px}.dash th,.dash td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--borda)}.dash th:first-child,.dash td:first-child{text-align:left}
.filtro{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (min-width:860px){.pagina{padding:var(--e6) 40px 64px}}
@media (min-width:1024px){.grade.duas{grid-template-columns:repeat(12,minmax(0,1fr))}.c5{grid-column:span 5}.c6{grid-column:span 6}.c7{grid-column:span 7}}
#estado{max-width:640px}#estado[data-passo*=pronto]{max-width:none}
.pronto-grade{display:grid;gap:var(--e5)}.pg-cmd{order:-1}
@media (min-width:1024px){.pronto-grade{grid-template-columns:1fr 1fr}.pg-cmd{order:0}}
.vazio{display:grid;justify-items:center;gap:var(--e2);padding:var(--e6) var(--e4);text-align:center;color:var(--suave)}.vazio .ic{width:2rem;height:2rem}.vazio p{margin:0}
.convite select,.convite input[type=date]{width:auto}
@media (min-width:640px){.kpis{grid-template-columns:repeat(3,1fr)}}
@media (max-width:420px){.comandos{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}.giro{border-top-color:var(--borda)}}
`

const ICONES = {
  celular: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  alerta: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  cima: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  baixo: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  casa: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  grafico: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  escudo: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  recolher: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  pessoa: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  estrela: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  coracao: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  raio: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  folha: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  chama: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  foguete: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  troca: '<path d="M17 3l4 4-4 4"/><path d="M3 7h18"/><path d="M7 21l-4-4 4-4"/><path d="M21 17H3"/>',
}
const ic = (nome: keyof typeof ICONES, classe = '') =>
  `<svg class="ic${classe ? ` ${classe}` : ''}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES[nome]}</svg>`

// arquivos servidos por /mascote.svg e /logo.svg (src/assets)
const marca = (href = '/', cheia = false) =>
  `<a class="marca" href="${href}" aria-label="WCOEN, início">${cheia ? '<img class="logo-cheia" src="/logo.svg" alt="WCOEN">' : '<img class="logo" src="/mascote.svg" alt=""><span>WCOEN</span>'}</a>`

const layout = (titulo: string, corpo: string, script = '') =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><link rel="icon" type="image/svg+xml" href="/mascote.svg"><title>${esc(titulo)} · WCOEN</title><style>${ESTILO}</style><script src="/app.js"></script></head><body><a class="pular" href="#conteudo">Pular para o conteúdo</a>${corpo}${script}</body></html>`

const topo = (titulo: string, sub = '') => `<header class="topo-tela"><h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</header>`

// menu lateral das telas logadas (painel, dashboard, admin, perfil)
type Tela = 'painel' | 'dashboard' | 'admin' | 'perfil'
const NAV: Tela[] = ['painel', 'dashboard', 'admin']
const PAPEIS: Record<Papel, string> = { usuario: 'Usuário', admin: 'Administrador' }
const TELAS: Record<Tela, [string, keyof typeof ICONES]> = { painel: ['Painel', 'casa'], dashboard: ['Dashboard', 'grafico'], admin: ['Administração', 'escudo'], perfil: ['Perfil', 'pessoa'] }

export const perfilDe = (c: Conta): Perfil => ({ nome: c.nome, cor: c.avatarCor, icone: c.avatarIcone })
const corDe = (p?: Perfil) => ((AVATAR_CORES as readonly string[]).includes(p?.cor ?? '') ? p!.cor! : 'vermelho')
const avatar = (email: string, p?: Perfil) => {
  const icone = (AVATAR_ICONES as readonly string[]).includes(p?.icone ?? '') && p!.icone !== 'inicial' ? (p!.icone as keyof typeof ICONES) : null
  return `<span class="avatar av-${corDe(p)}" aria-hidden="true">${icone ? ic(icone) : esc([...(p?.nome?.trim() || email)][0]?.toUpperCase() ?? '?')}</span>`
}

const shell = (ativa: Tela, email: string, papel: Papel, principal: string, script = '', perfil?: Perfil) => {
  const itens = NAV
    .filter((t) => t !== 'admin' || papel === 'admin')
    .map((t) => `<a class="item" href="/${t}"${t === ativa ? ' aria-current="page"' : ''}>${ic(TELAS[t][1])}<span class="rotulo">${TELAS[t][0]}</span></a>`)
    .join('')
  const inicio = '/painel'
  const nome = perfil?.nome?.trim()
  return layout(
    TELAS[ativa][0],
    `<div class="app"><div class="barra-mobile"><button class="item" type="button" id="gaveta-abrir" aria-label="Abrir menu" aria-controls="menu" aria-expanded="false">${ic('menu')}</button>${marca(inicio)}</div><div class="veu" id="veu"></div><aside class="menu" id="menu"><div class="menu-topo">${marca(inicio)}<button class="icone" type="button" id="menu-alternar" aria-label="Recolher menu" aria-controls="menu" aria-expanded="true" title="Recolher menu">${ic('recolher')}</button></div><nav aria-label="Menu principal">${itens}</nav><div class="menu-base"><button class="item" type="button" id="tema-alternar" title="Alternar tema claro/escuro">${ic('lua', 'ic-lua')}${ic('sol', 'ic-sol')}<span class="rotulo">Tema</span></button><details class="perfil"><summary class="item" title="Perfil">${avatar(email, perfil)}<span class="rotulo">Perfil</span></summary><div class="perfil-menu"><p class="perfil-email">${esc(nome || email)}</p>${nome ? `<p class="sub">${esc(email)}</p>` : ''}<p class="sub">${PAPEIS[papel]}</p><a class="item" href="/perfil">Meu perfil</a></div></details><form method="post" action="/sair"><button class="item" title="Sair">${ic('sair')}<span class="rotulo">Sair</span></button></form></div></aside><div class="conteudo"><div class="pagina">${principal}</div></div></div>`,
    script,
  )
}

// /app.js: tema e menu lembrados no navegador (a CSP não permite script inline)
export const SCRIPT_APP = `const r = document.documentElement
const ler = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const gravar = (k, v) => { try { localStorage.setItem(k, v) } catch {} }
r.dataset.tema = ler('tema') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')
if (ler('menu') === 'estreito') r.dataset.menu = 'estreito'
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id)
  const sinc = () => {
    $('menu-alternar')?.setAttribute('aria-expanded', String(r.dataset.menu !== 'estreito'))
    $('gaveta-abrir')?.setAttribute('aria-expanded', String(r.dataset.gaveta === 'aberta'))
  }
  const perfil = document.querySelector('.perfil')
  sinc()
  $('tema-alternar')?.addEventListener('click', () => {
    r.dataset.tema = r.dataset.tema === 'dark' ? 'light' : 'dark'
    gravar('tema', r.dataset.tema)
  })
  $('menu-alternar')?.addEventListener('click', () => {
    if (r.dataset.menu === 'estreito') delete r.dataset.menu
    else r.dataset.menu = 'estreito'
    gravar('menu', r.dataset.menu || 'largo')
    sinc()
  })
  $('gaveta-abrir')?.addEventListener('click', () => { r.dataset.gaveta = 'aberta'; sinc() })
  $('veu')?.addEventListener('click', () => { delete r.dataset.gaveta; sinc() })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    delete r.dataset.gaveta
    perfil?.removeAttribute('open')
    sinc()
  })
  document.addEventListener('click', (e) => { if (perfil && !perfil.contains(e.target)) perfil.removeAttribute('open') })
})
`

// exemplo real do que o bot responde no grupo (conteúdo do WhatsApp, por isso mantém os emojis)
const BALAO = `<div class="balao" role="img" aria-label="Exemplo de mensagem do bot: balancete do dia com saldo de R$ 404,10"><div aria-hidden="true"><p><b>📊 BALANCETE DO DIA</b><br><i>15/09/2026</i></p><hr><p>🟢 Receitas<br><b>R$ 450,00</b></p><p>🔴 Despesas<br><b>R$ 45,90</b></p><p style="margin:0">💚 <b>SALDO</b><br><b>R$ 404,10</b></p></div></div><p class="legenda">Assim o bot responde no seu grupo.</p>`

const telaAuth = (titulo: string, conteudo: string) =>
  layout(
    titulo,
    `<div class="auth"><aside class="vitrine">${marca('/', true)}<p class="tagline">Seu controle financeiro pelo WhatsApp</p><div class="extra"><h1>Lance no grupo. Acompanhe no automático.</h1><p class="tagline">Despesas e receitas numa mensagem, com balancete, extrato e auditoria na mesma conversa.</p><div style="margin-top:28px">${BALAO}</div></div></aside><main class="lado-form" id="conteudo"><div>${conteudo}</div></main></div>`,
  )

type CampoDef = { nome: string; rotulo: string; tipo?: string; valor?: string; extra?: string; erro?: string }
const campo = ({ nome, rotulo, tipo = 'text', valor = '', extra = '', erro }: CampoDef) =>
  `<div class="campo"><label for="${nome}">${rotulo}</label><input id="${nome}" name="${nome}" type="${tipo}" required ${valor ? `value="${esc(valor)}" ` : ''}${erro ? `aria-invalid="true" aria-describedby="erro-${nome}" ` : ''}${extra}>${erro ? `<p class="erro-campo" id="erro-${nome}" role="alert">${ic('alerta')}<span>${esc(erro)}</span></p>` : ''}</div>`

const aviso = (texto?: string, classe = '') => (texto ? `<div class="aviso ${classe}" role="${classe === 'ok' ? 'status' : 'alert'}">${ic(classe === 'ok' ? 'check' : 'alerta')}<span>${esc(texto)}</span></div>` : '')

const vazio = (icone: keyof typeof ICONES, texto: string) => `<div class="vazio">${ic(icone)}<p>${texto}</p></div>`

export const paginaEntrar = (erro?: string, email = '') =>
  telaAuth(
    'Entrar',
    `<section class="cartao"><h2>Entrar</h2><p class="sub">Acesse seu painel.</p>${aviso(erro)}<form method="post" action="/entrar">${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: email, extra: 'autocomplete="username"' })}${campo({ nome: 'senha', rotulo: 'Senha', tipo: 'password', extra: 'autocomplete="current-password"' })}<button class="btn">Entrar</button></form><p class="rodape-form"><a href="/esqueci-senha">Esqueci minha senha</a></p></section><p class="rodape-form">Ainda não tem conta? <a href="/cadastro">Cadastre-se</a></p>`,
  )

export const paginaEsqueciSenha = (enviado = false, email = '') =>
  telaAuth(
    'Esqueci minha senha',
    enviado
      ? `<section class="cartao"><h2>Verifique seu e-mail</h2><p class="sub">Se esse e-mail existir na nossa base, enviamos um link para redefinir a senha. O link vale por 1 hora.</p></section><p class="rodape-form"><a href="/entrar">Voltar para Entrar</a></p>`
      : `<section class="cartao"><h2>Esqueci minha senha</h2><p class="sub">Informe seu e-mail para receber um link de redefinição.</p><form method="post" action="/esqueci-senha">${campo({ nome: 'email', rotulo: 'E-mail', tipo: 'email', valor: email, extra: 'autocomplete="username"' })}<button class="btn">Enviar link</button></form></section><p class="rodape-form"><a href="/entrar">Voltar para Entrar</a></p>`,
  )

export const paginaRedefinirSenha = (token: string, erro?: string) =>
  telaAuth(
    'Redefinir senha',
    `<section class="cartao"><h2>Redefinir senha</h2><p class="sub">Escolha uma nova senha para sua conta.</p>${aviso(erro)}<form method="post" action="/redefinir-senha"><input type="hidden" name="token" value="${esc(token)}">${campo({ nome: 'senha', rotulo: 'Nova senha (mínimo 8 caracteres)', tipo: 'password', extra: 'minlength="8" autocomplete="new-password"' })}<button class="btn">Redefinir senha</button></form></section>`,
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

export const ERROS_ADMIN: Record<string, string> = {
  data: 'Data inválida. Escolha o último dia de acesso no calendário.',
  proprio: 'Você não pode alterar a própria permissão.',
  fixo: 'Esta conta é administradora fixa (ADMIN_EMAILS) e só pode ser alterada na configuração do servidor.',
}
export const AVISOS_ADMIN: Record<string, string> = {
  redefinicao: 'Link de redefinição enviado.',
  papel: 'Permissão atualizada.',
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

export const paginaPainel = (email: string, fragmento: string, passo: string, erro?: string, admin = false, perfil?: Perfil) =>
  shell('painel', email, admin ? 'admin' : 'usuario', `<main id="conteudo">${topo('Painel', 'Conecte seu WhatsApp e acompanhe o bot')}${aviso(erro)}<div class="cartao" id="estado" data-passo="${esc(passo)}" aria-live="polite">${fragmento}</div></main>`, '<script src="/painel.js"></script>', perfil)

// --- dashboard -----------------------------------------------------------

const nomeMes = (ano: number, mes: number) => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(ano, mes - 1, 1)))

// subir receita/saldo é bom; subir despesa não é
const variacao = (v: number | null, altaEhBoa: boolean) => {
  if (v === null) return '<span class="var neutro">— sem mês anterior para comparar</span>'
  if (v === 0) return '<span class="var neutro">0% vs. mês anterior</span>'
  const bom = v > 0 === altaEhBoa
  return `<span class="var ${bom ? 'bom' : 'ruim'}">${ic(v > 0 ? 'cima' : 'baixo')}${v > 0 ? '+' : ''}${v}% vs. mês anterior</span>`
}

const kpi = (rotulo: string, valor: number, v: number | null, altaEhBoa: boolean) =>
  `<div class="kpi"><div class="rot">${rotulo}</div><div class="num">${formatBRL(valor)}</div>${variacao(v, altaEhBoa)}</div>`

// o dashboard é sempre da própria conta: nem o admin enxerga os valores de outras
export const paginaDashboard = (email: string, ind: Indicadores, admin: boolean, perfil?: Perfil) => {
  const corpo = ind.vazio
    ? `<div class="cartao">${vazio('grafico', 'Nenhum lançamento nos últimos 6 meses. Registre uma despesa ou receita no grupo do WhatsApp e ela aparece aqui.')}</div>`
    : `<div class="kpis">${kpi('Saldo do mês', ind.saldo, ind.variacao.saldo, true)}${kpi('Receitas', ind.mes.receitas, ind.variacao.receitas, true)}${kpi('Despesas', ind.mes.despesas, ind.variacao.despesas, false)}</div><div class="grade duas">
<section class="cartao c7"><h2>Últimos ${ind.serie.length} meses</h2>${svgTendencia(ind.serie)}<ul class="legenda"><li><i class="l-rec"></i>Receitas</li><li><i class="l-desp"></i>Despesas</li></ul>
<details><summary>Ver dados em tabela</summary><table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th></tr></thead><tbody>${ind.serie.map((s) => `<tr><td>${rotuloMesCurto(s)}/${s.ano}</td><td>${formatBRL(s.receitas)}</td><td>${formatBRL(s.despesas)}</td></tr>`).join('')}</tbody></table></details></section>
<section class="cartao c5"><h2>Despesas por categoria</h2>${ind.categorias.length ? `<ul class="cats">${ind.categorias.map((c) => `<li><span class="nome">${esc(c.conta)}</span><span class="valor">${formatBRL(c.total)}</span><div class="trilho" aria-hidden="true"><div style="width:${c.largura}%"></div></div></li>`).join('')}</ul>` : vazio('grafico', 'Sem despesas neste mês.')}</section></div>`
  return shell('dashboard', email, admin ? 'admin' : 'usuario', `<main id="conteudo" class="dash">${topo('Dashboard', nomeMes(ind.mes.ano, ind.mes.mes))}${corpo}</main>`, '', perfil)
}

// --- administração (convites) --------------------------------------------

const dataHora = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d)

const itemConvite = (c: Convite) => {
  const aberto = !c.usadoEm
  const revogar = aberto ? `<form method="post" action="/admin/convites/revogar"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sec pequeno">Revogar</button></form>` : ''
  return `<li class="convite"><div><code>${esc(c.codigo)}</code>${c.nota ? ` <span class="sub">· ${esc(c.nota)}</span>` : ''}<div class="sub">${dataHora(c.criadoEm)}</div></div><span class="chip ${aberto ? 'chip-ok' : ''}">${aberto ? 'Aberto' : 'Usado'}</span>${revogar}</li>`
}

const dataHoraCurta = (d: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d)

const dataBR = (iso: string) => iso.split('-').reverse().join('/')

// o seletor de permissão só aparece para quem o admin pode mudar: não para si mesmo nem para os admins fixos (ADMIN_EMAILS)
const itemConta = (c: ContaResumo, editavel: boolean) => {
  const status = !c.ativa ? '<span class="chip">Desativada</span>' : c.vencida ? '<span class="chip">Vencida</span>' : '<span class="chip chip-ok">Ativa</span>'
  const conexao = c.conectada ? `<span class="sub">· conectada${c.grupoNome ? ` (${esc(c.grupoNome)})` : ''}</span>` : ''
  const alternar = `<form method="post" action="/admin/contas/${c.ativa ? 'desativar' : 'reativar'}"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sec pequeno">${c.ativa ? 'Desativar' : 'Reativar'}</button></form>`
  const redefinir = c.ativa
    ? `<form method="post" action="/admin/contas/redefinir"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sec pequeno">Enviar link de redefinição</button></form>`
    : ''
  const atual = c.papel === 'admin' ? 'admin' : c.validadeAte ? 'validade' : 'usuario'
  const opcao = (v: string, rotulo: string) => `<option value="${v}"${v === atual ? ' selected' : ''}>${rotulo}</option>`
  const permissao = editavel
    ? `<form method="post" action="/admin/contas/papel" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="hidden" name="id" value="${esc(c.id)}"><select name="papel" aria-label="Permissão de ${esc(c.email)}">${opcao('admin', 'Administrador')}${opcao('usuario', 'Usuário')}${opcao('validade', 'Usuário com validade')}</select><input type="date" name="ate" value="${esc(c.validadeAte ?? '')}" aria-label="Último dia de acesso"><button class="btn sec pequeno">Salvar</button></form>`
    : ''
  const papel = `<span class="chip">${c.papel === 'admin' ? 'Administrador' : 'Usuário'}</span>${c.validadeAte ? `<span class="sub">Até ${dataBR(c.validadeAte)}</span>` : ''}`
  return `<li class="convite"><div><code>${esc(c.email)}</code> <span class="sub">· ${dataHoraCurta(c.criadaEm)}</span>${conexao}</div>${status}${papel}${permissao}${alternar}${redefinir}</li>`
}

export const paginaAdmin = (email: string, convites: Convite[], contasAdmin: ContaResumo[] = [], mensagem?: string, perfil?: Perfil, fixos: string[] = []) =>
  shell('admin', email, 'admin', `<main id="conteudo">${topo('Administração', 'Convites e contas')}${aviso(mensagem)}<div class="grade duas"><div class="cartao c5"><h2>Novo convite</h2><p class="sub">Gera um código de uso único para um cadastro.</p><form method="post" action="/admin/convites"><div class="campo"><label for="nota">Nota (opcional)</label><input id="nota" name="nota" type="text" maxlength="80" placeholder="Ex.: para o João"></div><button class="btn">Gerar convite</button></form></div><div class="pilha c7"><div class="cartao"><h2>Convites</h2>${convites.length ? `<ul class="convites">${convites.map(itemConvite).join('')}</ul>` : vazio('escudo', 'Nenhum convite ainda.')}</div><div class="cartao"><h2>Contas</h2>${contasAdmin.length ? `<ul class="convites">${contasAdmin.map((c) => itemConta(c, c.email !== email && !fixos.includes(c.email))).join('')}</ul>` : vazio('escudo', 'Nenhuma conta cadastrada ainda.')}</div></div></div></main>`, '', perfil)

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
  ['Lançar despesa', '/d mercado 45,90'],
  ['Lançar receita', '/r plantão 70'],
  ['Movimento de hoje', '/balancete'],
  ['Todos os lançamentos', '/extrato'],
  ['Corrigir o último', '/desfazer'],
  ['Ver todos os comandos', '/ajuda'],
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
  return `${passos(3)}<div class="cabeca"><h2 class="pronto">${ic('check')}Tudo pronto</h2>${chip(v.estado)}</div><div class="pronto-grade"><div class="pg-info"><p class="grupo">Grupo: <strong>${esc(conta.grupoNome ?? conta.grupoId)}</strong></p><details><summary>${ic('troca')}&nbsp;Trocar grupo</summary>${seletorGrupo(grupos, conta.grupoId)}</details>${botao('/painel/desconectar', 'Desconectar', 'sec')}</div><div class="pg-cmd"><p class="sub">Digite no grupo:</p><ul class="comandos">${COMANDOS.map(([rot, cmd]) => `<li><span class="rot">${rot}</span><code>${cmd}</code></li>`).join('')}</ul></div></div>`
}

// --- perfil ---------------------------------------------------------------

export const ERROS_PERFIL: Record<string, string> = {
  confirmacao: 'A confirmação não confere com a nova senha.',
  senha_atual: 'Senha atual incorreta.',
  senha_curta: 'A nova senha precisa ter ao menos 8 caracteres.',
  limite: 'Muitas tentativas. Aguarde alguns minutos.',
}
export const AVISOS_PERFIL: Record<string, string> = {
  salvo: 'Perfil salvo.',
  senha: 'Senha alterada. Os outros aparelhos foram desconectados.',
  aparelhos: 'Os outros aparelhos foram desconectados.',
}

const NOMES_COR: Record<(typeof AVATAR_CORES)[number], string> = { vermelho: 'Vermelho', laranja: 'Laranja', amarelo: 'Amarelo', verde: 'Verde', azul: 'Azul', roxo: 'Roxo', rosa: 'Rosa', cinza: 'Cinza' }
const NOMES_ICONE: Record<(typeof AVATAR_ICONES)[number], string> = { inicial: 'Inicial', pessoa: 'Pessoa', estrela: 'Estrela', coracao: 'Coração', raio: 'Raio', folha: 'Folha', chama: 'Chama', foguete: 'Foguete' }

const opcaoCor = (c: (typeof AVATAR_CORES)[number], atual: string) =>
  `<label class="op"><input type="radio" name="cor" value="${c}"${c === atual ? ' checked' : ''}><span class="avatar av-${c}" aria-hidden="true"></span><span class="so-leitor">${NOMES_COR[c]}</span></label>`
const opcaoIcone = (i: (typeof AVATAR_ICONES)[number], atual: string) =>
  `<label class="op"><input type="radio" name="icone" value="${i}"${i === atual ? ' checked' : ''}><span class="avatar neutro" aria-hidden="true">${i === 'inicial' ? 'A' : ic(i)}</span><span class="so-leitor">${NOMES_ICONE[i]}</span></label>`

export const paginaPerfil = (conta: Conta, papel: Papel, estado: Visao['estado'], mensagem: { erro?: string; ok?: string } = {}) => {
  const dados = `<dl class="dados"><dt>E-mail</dt><dd>${esc(conta.email)}</dd><dt>Papel</dt><dd>${PAPEIS[papel]}</dd>${conta.criadaEm ? `<dt>Membro desde</dt><dd>${dataHoraCurta(conta.criadaEm)}</dd>` : ''}</dl>`
  const cabeca = `${topo('Perfil', 'Sua conta e preferências')}${aviso(mensagem.erro)}${aviso(mensagem.ok, 'ok')}`
  const corAtual = conta.avatarCor ?? 'vermelho'
  const iconeAtual = conta.avatarIcone ?? 'inicial'
  const identidade = `<section class="cartao c6"><h2>Identidade</h2><form method="post" action="/perfil"><div class="campo"><label for="nome">Nome de exibição</label><input id="nome" name="nome" type="text" maxlength="40" autocomplete="name" placeholder="Como você quer aparecer" value="${esc(conta.nome ?? '')}"></div><fieldset class="opcoes"><legend>Cor do avatar</legend>${AVATAR_CORES.map((c) => opcaoCor(c, corAtual)).join('')}</fieldset><fieldset class="opcoes"><legend>Ícone do avatar</legend>${AVATAR_ICONES.map((i) => opcaoIcone(i, iconeAtual)).join('')}</fieldset><button class="btn">Salvar perfil</button></form></section>`
  const whatsapp = `<section class="cartao"><div class="cabeca"><h2>WhatsApp</h2>${chip(estado)}</div><p class="sub">${conta.grupoNome ? `Grupo: <strong>${esc(conta.grupoNome)}</strong>` : 'Nenhum grupo escolhido.'}</p><p><a href="/painel">Abrir o painel</a></p></section>`
  const seguranca = `<section class="cartao"><h2>Segurança</h2><form method="post" action="/perfil/senha">${campo({ nome: 'atual', rotulo: 'Senha atual', tipo: 'password', extra: 'autocomplete="current-password"' })}${campo({ nome: 'nova', rotulo: 'Nova senha (mínimo 8 caracteres)', tipo: 'password', extra: 'minlength="8" autocomplete="new-password"' })}${campo({ nome: 'confirmacao', rotulo: 'Confirme a nova senha', tipo: 'password', extra: 'minlength="8" autocomplete="new-password"' })}<button class="btn">Trocar senha</button></form><hr style="border:0;border-top:1px solid var(--borda);margin:20px 0"><p class="sub">Encerra a sessão em todos os outros aparelhos e navegadores. Esta continua aberta.</p><form method="post" action="/perfil/sair-aparelhos"><button class="btn sec">Sair dos outros aparelhos</button></form></section>`
  return shell('perfil', conta.email, papel, `<main id="conteudo">${cabeca}<div class="grade duas">${identidade}<div class="pilha c6"><section class="cartao"><h2>Conta</h2>${dados}</section>${whatsapp}${seguranca}</div></div></main>`, '', perfilDe(conta))
}
