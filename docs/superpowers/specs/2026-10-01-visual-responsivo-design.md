# Visual responsivo e profissional (desktop + celular)

Data: 2026-10-01 · Escopo: `src/paginas.ts` (CSS inline e templates SSR) e `tests/paginas.test.ts`.

## Objetivo

Tornar o portal web responsivo de verdade no desktop e no celular, com animações de transição, sem o conteúdo centralizado no meio da página, e com acabamento mais profissional. A parte visual segue a skill ui-ux-pro-max (estilo Minimalism & Swiss para SaaS/dashboard).

## Restrições

- CSP atual: `default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'`. Sem fontes externas, sem GSAP, sem script inline. Animações só em CSS; JS novo só se couber em `/app.js`.
- Mantém identidade vermelha do WCOEN, tema claro/escuro (`data-tema`) e a pilha de fontes do sistema.
- Fora do escopo: regras de negócio, bot, banco, novas páginas.

## 1. Layout desktop (≥ 860px)

- `.pagina` deixa de usar `margin: 0 auto` e `max-width: 560/880px`: ocupa a área ao lado do menu, alinhada à esquerda, padding 32px, teto ~1280px.
- Cada tela logada ganha cabeçalho padrão (título + subtítulo) e grade de 12 colunas:
  - **Dashboard:** 3 KPIs em linha; abaixo, gráfico (7 col.) + despesas por categoria (5 col.).
  - **Painel:** duas colunas. Esquerda: card de conexão com passos. Direita: comandos do bot e grupo (hoje empilhados no mesmo card).
  - **Perfil:** duas colunas. Esquerda: Identidade. Direita: Conta, WhatsApp, Segurança empilhados.
  - **Admin:** "Novo convite" estreito à esquerda; Convites e Contas à direita em lista densa.
- Telas de entrada/cadastro (já em duas colunas): só acabamento visual.

## 2. Celular (< 860px)

- Gaveta de menu mantida, com deslize animado e véu que esmaece.
- Grade em coluna única, padding 16px, `env(safe-area-inset-*)`.
- Alvos de toque ≥ 44px; linhas de admin quebram sem rolagem horizontal.

## 3. Animações (CSS puro)

- Transição entre páginas: `@view-transition { navigation: auto }`; conteúdo faz fade + desliza 8px (~200ms); menu lateral com `view-transition-name` próprio para não piscar. Sem suporte → navegação normal.
- Entrada em cascata de cards/KPIs (stagger 40ms, 250ms cada); barras do gráfico e trilhos de categoria crescem ao carregar.
- Micro-interações: hover de card (sobe 1px, sombra), press de botão, troca suave de tema.
- Só `transform` e `opacity`. Easing `cubic-bezier(.2,.8,.2,1)` na entrada; saída mais rápida que a entrada.
- Tudo desligado em `prefers-reduced-motion` (regra já existente, estendida).

## 4. Acabamento

- Tokens no `:root`: espaçamento (4/8/12/16/24/32), raios, duas sombras (repouso/elevada).
- Tipografia: hierarquia clara, rótulos pequenos, `tabular-nums` nos números.
- Item ativo do menu com barra de destaque à esquerda; estados vazios com ícone.
- Sem emoji como ícone (exceto o balão que reproduz o WhatsApp).
- Contraste ≥ 4.5:1, foco visível, `cursor:pointer` nos clicáveis.

## 5. Testes e verificação

- `npm test` e `npm run typecheck` passam; asserções que dependam de classes antigas são ajustadas só quando necessário.
- Verificação visual real (Chrome) em 375, 768, 1024 e 1440px, tema claro e escuro, em todas as telas logadas e de entrada.
- Checklist ui-ux-pro-max: sem rolagem horizontal, reduced-motion respeitado, estados hover/focus/ativo.

## Fora de escopo / limites conhecidos

- View Transitions entre páginas só em navegadores com suporte (Chrome/Edge/Safari recentes).
- Fontes web e GSAP exigiriam relaxar a CSP; não será feito.
