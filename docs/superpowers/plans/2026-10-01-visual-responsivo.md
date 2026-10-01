# Visual responsivo e profissional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar as telas do WCOEN responsivas (desktop em grade de largura total + celular), com animações de transição e acabamento profissional.

**Architecture:** Todo o visual vive em `src/paginas.ts` (CSS inline na constante `ESTILO` + templates SSR). Mudamos tokens/CSS e a marcação das 4 telas logadas (painel, dashboard, admin, perfil), mais um cabeçalho padrão `topo()` e uma grade `.grade.duas`. Animações só em CSS (View Transitions nativas + keyframes), sem JS novo.

**Tech Stack:** TypeScript, HTML/CSS renderizado no servidor, vitest. Sem dependências novas (CSP: `default-src 'self'; style-src 'unsafe-inline'`).

**Spec:** `docs/superpowers/specs/2026-10-01-visual-responsivo-design.md`

## Global Constraints

- CSP atual: sem fontes externas, sem GSAP, sem script inline, sem `http(s)://` nas páginas (teste existente) e sem `@import`.
- Manter identidade vermelha do WCOEN, tema claro/escuro (`data-tema`) e fontes do sistema.
- Só `transform` e `opacity` são animados; tudo desligado em `prefers-reduced-motion`.
- Alvos de toque ≥ 44px; sem rolagem horizontal; foco visível.
- Marcação que testes existentes fixam e NÃO pode mudar: `<li class="convite"><div><code>…</code> <span class="sub">· …</span>`, `<details class="perfil"`, `id="estado"` com `aria-live="polite"`, `<script src="/app.js"></script>`, `class="chip …"`, textos "Nenhum convite", `.passos` com `aria-current="step"`.
- Fora de escopo: regras de negócio, bot, banco, novas páginas, fontes web.
- Os testes de `tests/paginas.test.ts` não precisam de banco, mas o `vitest.config.ts` exige Postgres (`setupFiles`). Por isso a Task 0 cria uma config só para páginas.

## Review Focus

- Painel em cada estado (desconectado, conectando, QR, escolher grupo, pronto): o card não pode quebrar nem estourar a largura; só o estado "pronto" usa duas colunas (`#estado[data-passo*=pronto]`).
- Dashboard vazio (sem lançamentos) e sem despesas no mês: mostra estado vazio com ícone, sem grade quebrada.
- Atualização ao vivo (SSE troca `innerHTML` de `#estado`): a animação de entrada não pode reiniciar nem esconder o conteúdo.
- `prefers-reduced-motion`: nenhuma animação nem `::view-transition` roda e o conteúdo fica visível (animações usam `both`, então desligar não pode deixar `opacity:0`).
- Nome/e-mail com HTML ou muito longo no menu e na lista de contas continua escapado e quebrando linha (sem rolagem horizontal).

---

### Task 0: Config de teste sem banco

**Files:**
- Create: `vitest.paginas.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Criar a config**

```ts
import { defineConfig } from 'vitest/config'

// testes de páginas são puros (HTML em string): rodam sem Postgres
export default defineConfig({ test: {} })
```

- [ ] **Step 2: Adicionar o script em `package.json`**, depois de `"test"`:

```json
    "test:paginas": "vitest run tests/paginas.test.ts --config vitest.paginas.config.ts",
```

- [ ] **Step 3: Rodar** — `npm run test:paginas`. Esperado: `55 passed`.

- [ ] **Step 4: Commit**

```bash
git add vitest.paginas.config.ts package.json
git commit -m "test: script test:paginas roda os testes de página sem Postgres

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Tokens, layout fluido e cabeçalho padrão

**Files:**
- Modify: `src/paginas.ts` (`ESCURO`, `ESTILO`, `layout`, `shell`, 4 chamadas de `shell`)
- Test: `tests/paginas.test.ts` (novo `describe` no fim do arquivo)

**Interfaces:**
- Produces: `topo(titulo: string, sub?: string): string` (cabeçalho `<header class="topo-tela">`); classes `.grade`, `.grade.duas`, `.c5`, `.c6`, `.c7`; `shell(ativa, email, papel, principal, script = '', perfil?)` (parâmetro `larga` removido). Tasks 2–4 usam essas classes.

- [ ] **Step 1: Escrever os testes que falham** — no fim de `tests/paginas.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:paginas`. Esperado: 3 falhas novas.

- [ ] **Step 3: Implementar em `src/paginas.ts`**

3a. `ESCURO` — acrescente no fim da string (antes da aspa final): `;--sombra2:0 10px 30px rgba(0,0,0,.5)`.

3b. Linha do `:root{color-scheme:light dark;...}` — acrescente antes do `}` final: `;--e1:4px;--e2:8px;--e3:12px;--e4:16px;--e5:24px;--e6:32px;--raio:16px;--sombra2:0 2px 4px rgba(40,10,10,.08),0 14px 32px rgba(40,10,10,.14);--ease:cubic-bezier(.2,.8,.2,1)`.

3c. Em `.cartao{...}` troque `border-radius:16px` por `border-radius:var(--raio)`; em `.kpi{...}` troque `border-radius:14px` por `border-radius:var(--raio)`.

3d. Substitua as duas linhas `.pagina{...}` e `.pagina.larga{...}` (dentro de `/* painel */`) por:

```css
.pagina{max-width:1280px;padding:var(--e4) var(--e4) calc(var(--e6) + env(safe-area-inset-bottom))}
.pagina>main{display:grid;gap:var(--e4);align-content:start}.pagina>main>.aviso{margin:0}
.topo-tela h1{margin:0;font-size:clamp(1.5rem,1.2rem + 1vw,2rem)}.topo-tela .sub{margin:var(--e1) 0 0}
.grade{display:grid;gap:var(--e4);align-items:start}
.cartao,.kpi,.comandos li,.menu,input,select{transition:background-color .25s,border-color .25s,color .25s,box-shadow .2s var(--ease),transform .2s var(--ease)}
```

3e. Antes da linha `@media (min-width:640px){.kpis{...}}`, acrescente:

```css
@media (min-width:860px){.pagina{padding:var(--e6) 40px 64px}}
@media (min-width:1024px){.grade.duas{grid-template-columns:repeat(12,minmax(0,1fr))}.c5{grid-column:span 5}.c6{grid-column:span 6}.c7{grid-column:span 7}}
```

3f. `layout()` — no `<meta name="viewport" ...>` troque `initial-scale=1` por `initial-scale=1,viewport-fit=cover`.

3g. Antes de `// menu lateral das telas logadas`, acrescente:

```ts
const topo = (titulo: string, sub = '') => `<header class="topo-tela"><h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</header>`
```

3h. `shell`: assinatura vira `(ativa: Tela, email: string, papel: Papel, principal: string, script = '', perfil?: Perfil)`; no final do template troque `<div class="pagina${larga ? ' larga' : ''}">` por `<div class="pagina">`.

3i. Atualize as 4 chamadas (removem o argumento `larga`):
- `paginaPainel`: `..., false, '<script src="/painel.js"></script>', perfil)` → `..., '<script src="/painel.js"></script>', perfil)`; e o `principal` vira `` `<main id="conteudo">${topo('Painel', 'Conecte seu WhatsApp e acompanhe o bot')}${aviso(erro)}<div class="cartao" id="estado" data-passo="${esc(passo)}" aria-live="polite">${fragmento}</div></main>` ``.
- `paginaDashboard`: `<div><h1>Dashboard</h1><p class="sub">${nomeMes(...)}</p></div>` → `${topo('Dashboard', nomeMes(ind.mes.ano, ind.mes.mes))}`; `, true, '', perfil)` → `, '', perfil)`.
- `paginaAdmin`: insira `${topo('Administração', 'Convites e contas')}` logo depois de `<main id="conteudo">`; `, false, '', perfil)` → `, '', perfil)`.
- `paginaPerfil`: `const cabeca = \`<div><h1>Perfil</h1></div>${aviso(...)}${aviso(...)}\`` → `` const cabeca = `${topo('Perfil', 'Sua conta e preferências')}${aviso(mensagem.erro)}${aviso(mensagem.ok, 'ok')}` ``; `, false, '', perfilDe(conta))` → `, '', perfilDe(conta))`.

- [ ] **Step 4: Rodar** — `npm run test:paginas` e `npm run typecheck`. Esperado: tudo passa.

- [ ] **Step 5: Commit**

```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: layout fluido, tokens e cabeçalho padrão nas telas logadas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Grades por tela (dashboard, painel, perfil, admin)

**Files:**
- Modify: `src/paginas.ts` (`paginaDashboard`, `fragmentoPainel`, `paginaPerfil`, `paginaAdmin`, CSS)
- Test: `tests/paginas.test.ts`

**Interfaces:**
- Consumes: `.grade.duas`, `.c5/.c6/.c7`, `topo()` (Task 1).
- Produces: `.vazio` (estado vazio com ícone) e `.pronto-grade`, `.pg-cmd`.

- [ ] **Step 1: Testes que falham**

```ts
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

  it('painel pronto: duas colunas, comandos antes no celular', () => {
    const html = frag({ estado: 'conectado' }, comGrupo)
    expect(html).toMatch(/class="pronto-grade"[\s\S]*class="pg-info"[\s\S]*class="pg-cmd"[\s\S]*\/d mercado 45,90/)
    expect(frag({ estado: 'desconectado' })).not.toContain('pronto-grade')
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
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:paginas`.

- [ ] **Step 3: Implementar**

3a. CSS (junto das regras de grade da Task 1, antes do `@media (min-width:640px)`):

```css
#estado{max-width:640px}#estado[data-passo*=pronto]{max-width:none}
.pronto-grade{display:grid;gap:var(--e5)}.pg-cmd{order:-1}
@media (min-width:1024px){.pronto-grade{grid-template-columns:1fr 1fr}.pg-cmd{order:0}}
.vazio{display:grid;justify-items:center;gap:var(--e2);padding:var(--e6) var(--e4);text-align:center;color:var(--suave)}.vazio .ic{width:2rem;height:2rem}.vazio p{margin:0}
.convite select,.convite input[type=date]{width:auto}
```

3b. Helper (perto de `aviso`):

```ts
const vazio = (icone: keyof typeof ICONES, texto: string) => `<div class="vazio">${ic(icone)}<p>${texto}</p></div>`
```

3c. `paginaDashboard` — `corpo`:

```ts
const corpo = ind.vazio
  ? `<div class="cartao">${vazio('grafico', 'Nenhum lançamento nos últimos 6 meses. Registre uma despesa ou receita no grupo do WhatsApp e ela aparece aqui.')}</div>`
  : `<div class="kpis">…(igual)…</div><div class="grade duas"><section class="cartao c7"><h2>Últimos …</h2>…(igual)…</section><section class="cartao c5"><h2>Despesas por categoria</h2>${ind.categorias.length ? `<ul class="cats">…(igual)…</ul>` : vazio('grafico', 'Sem despesas neste mês.')}</section></div>`
```

(Mantenha o conteúdo interno dos cartões exatamente como está; só muda o invólucro `<div class="grade duas">` e as classes `c7`/`c5`.)

3d. `fragmentoPainel`, ramo "pronto" — substitua o `return` final por:

```ts
return `${passos(3)}<div class="cabeca"><h2 class="pronto">${ic('check')}Tudo pronto</h2>${chip(v.estado)}</div><div class="pronto-grade"><div class="pg-info"><p class="grupo">Grupo: <strong>${esc(conta.grupoNome ?? conta.grupoId)}</strong></p><details><summary>${ic('troca')}&nbsp;Trocar grupo</summary>${seletorGrupo(grupos, conta.grupoId)}</details>${botao('/painel/desconectar', 'Desconectar', 'sec')}</div><div class="pg-cmd"><p class="sub">Digite no grupo:</p><ul class="comandos">${COMANDOS.map(([rot, cmd]) => `<li><span class="rot">${rot}</span><code>${cmd}</code></li>`).join('')}</ul></div></div>`
```

3e. `paginaPerfil` — troque o `main` por:

```ts
`<main id="conteudo">${cabeca}<div class="grade duas"><div class="c6">${identidade}</div><div class="pilha c6"><section class="cartao"><h2>Conta</h2>${dados}</section>${whatsapp}${seguranca}</div></div></main>`
```

e mude `identidade` para abrir com `<section class="cartao">` (já abre assim; a classe `c6` fica no `<div>` externo, então o teste procura `class="cartao c6"` — ajuste: faça `identidade` abrir com `<section class="cartao c6">` e remova o `<div class="c6">` envolvente).

3f. `paginaAdmin` — reorganize em: `${topo(...)}${aviso(mensagem)}<div class="grade duas"><div class="cartao c5">…Novo convite…</div><div class="pilha c7"><div class="cartao">…Convites…</div><div class="cartao">…Contas…</div></div></div>` (conteúdo interno inalterado; vazios: `'<p class="sub">Nenhum convite ainda.</p>'` → `vazio('escudo', 'Nenhum convite ainda.')`, idem `Nenhuma conta cadastrada ainda.`).

- [ ] **Step 4: Rodar** — `npm run test:paginas && npm run typecheck`. Esperado: passa (incluindo os testes antigos de painel/admin).

- [ ] **Step 5: Commit**

```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: grades de duas colunas e estados vazios com ícone

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Celular (gaveta animada, área segura)

**Files:**
- Modify: `src/paginas.ts` (CSS do bloco `@media (max-width:859px)`)
- Test: `tests/paginas.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** — no bloco `@media (max-width:859px)`:

- `.barra-mobile{...}` troque `padding:6px 10px` por `padding:max(6px,env(safe-area-inset-top)) 10px 6px`.
- `.menu{...transition:transform .2s,visibility .2s}` → `transition:transform .2s ease-in,visibility .2s`; e acrescente `html[data-gaveta=aberta] .menu{transition-duration:.28s;transition-timing-function:var(--ease)}`.
- Substitua a linha `html[data-gaveta=aberta] .veu{display:block;position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.45)}` por:

```css
.veu{display:block;position:fixed;inset:0;z-index:25;background:rgba(0,0,0,.45);opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s}
html[data-gaveta=aberta] .veu{opacity:1;visibility:visible}
```

(a regra global `.barra-mobile,.veu{display:none}` continua valendo no desktop.)

- [ ] **Step 4: Rodar** — `npm run test:paginas`.

- [ ] **Step 5: Commit**

```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: gaveta do menu animada e área segura no celular

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Animações e acabamento

**Files:**
- Modify: `src/paginas.ts` (CSS: bloco novo antes do `@media (prefers-reduced-motion…)`, e a própria regra de reduced-motion)
- Test: `tests/paginas.test.ts`

- [ ] **Step 1: Testes que falham**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** — acrescente antes da regra `@media (prefers-reduced-motion…)`:

```css
/* movimento */
@view-transition{navigation:auto}
.menu{view-transition-name:menu}.conteudo{view-transition-name:conteudo}
::view-transition-group(conteudo){animation:none}
::view-transition-old(conteudo){animation:sai .12s ease-in both}
::view-transition-new(conteudo){animation:none}
@keyframes entra{from{opacity:0;transform:translateY(8px)}}
@keyframes sai{to{opacity:0}}
.topo-tela,.cartao,.kpi,.lado-form>div{animation:entra .25s var(--ease) both}
:is(.kpis,.grade,.pilha,main)>:nth-child(2){animation-delay:40ms}
:is(.kpis,.grade,.pilha,main)>:nth-child(3){animation-delay:80ms}
:is(.kpis,.grade,.pilha,main)>:nth-child(n+4){animation-delay:120ms}
.grafico .b-rec,.grafico .b-desp{transform-box:fill-box;transform-origin:50% 100%;animation:cresce .5s var(--ease) .1s both}
.trilho div{transform-origin:0 50%;animation:cresce-x .6s var(--ease) .15s both}
@keyframes cresce{from{transform:scaleY(0)}}@keyframes cresce-x{from{transform:scaleX(0)}}
@media (hover:hover){.kpi:hover,.comandos li:hover{transform:translateY(-1px);box-shadow:var(--sombra2)}}
/* acabamento */
.item[aria-current=page]{position:relative}
.item[aria-current=page]::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:3px;background:var(--marca)}
.kpi .rot{text-transform:uppercase;letter-spacing:.06em;font-size:.78rem;font-weight:700}
.kpi .num,.cats .valor,.dash td{font-variant-numeric:tabular-nums}
```

e substitua a regra de reduced-motion por:

```css
@media (prefers-reduced-motion:reduce){*,::before,::after{transition:none!important;animation:none!important}::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}.giro{border-top-color:var(--borda)}}
```

(Como as animações usam `both` com `from` apenas, desligá-las deixa o estado final visível: nada fica em `opacity:0`.)

- [ ] **Step 4: Rodar** — `npm run test:paginas && npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/paginas.ts tests/paginas.test.ts
git commit -m "feat: transições entre páginas, entrada em cascata e acabamento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação visual e suíte completa

**Files:** nenhum (ajustes só se a verificação revelar bugs).

- [ ] **Step 1: Subir Postgres e rodar a suíte inteira**

Abra o Docker Desktop, depois: `docker compose up -d postgres` e `npm test && npm run typecheck`. Esperado: tudo verde (os testes de `web.test.ts` fixam marcação de convites e do perfil; se algo quebrar, ajuste o template, não o teste).

- [ ] **Step 2: Rodar o app** — `npm start` (usa `.env`), abrir em Chrome (`/entrar`, `/painel`, `/dashboard`, `/admin`, `/perfil`).

- [ ] **Step 3: Screenshots** em 375, 768, 1024 e 1440px, tema claro e escuro, em cada tela. Conferir: sem rolagem horizontal, grade de duas colunas só a partir de 1024px, gaveta abre/fecha com animação, navegação entre telas anima o conteúdo e o menu não pisca, estado "pronto" do painel em duas colunas, estado vazio do dashboard.

- [ ] **Step 4: Reduced motion** — no DevTools, emular `prefers-reduced-motion: reduce`; conferir que nada anima e todo conteúdo está visível.

- [ ] **Step 5: Corrigir o que aparecer, rodar `npm test` de novo e commitar** (`fix: …` por problema).

- [ ] **Step 6: Atualizar o spec** se algum item mudou (ex.: grade em duas colunas a partir de 1024px, não 860px; "pronto" com comandos à direita no desktop e antes no celular).
