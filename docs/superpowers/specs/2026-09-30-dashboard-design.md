# Dashboard de indicadores financeiros

## Objetivo
Nova tela `/dashboard` no portal, ao lado do painel de configuração, com indicadores financeiros calculados
a partir dos lançamentos que o bot já grava. Cada usuário vê só os dados da própria conta; só a conta DEV
enxerga todas.

## Decisões
- **Gráficos em SVG gerado no servidor, sem biblioteca nova.** O projeto não tem lib de gráfico (o `qrcode`
  já gera SVG no servidor), e o CSP `default-src 'self'` bloquearia um Chart.js por CDN. Servi-lo por nós
  custaria ~200 KB e um `script-src` novo. Barras e uma tendência de 6 meses não justificam isso.
  Reavaliar só se surgir pedido de tooltip/animação.
- **Nenhuma tabela nova.** Usa `lancamentos` (já filtrada por `conta_id`, ignorando `desfeito_em`).
- **Acesso:** o usuário comum usa sempre o `conta.id` da sessão; `?conta=` é ignorado para ele. O dev
  (`devEmail`) pode escolher "Todas as contas" ou uma conta. Admin comum (`ADMIN_EMAILS`) vê só os próprios
  dados: `isAdmin` continua valendo só para `/admin`.
- **Escopo B:** saldo/receitas/despesas do mês com variação sobre o mês anterior, tendência de **6 meses
  fixos** (sem seletor de período) e despesas por categoria do mês atual.
- Fora de escopo (YAGNI): período livre, exportar CSV, tooltip/animação, cache, maiores lançamentos e média
  diária.

## Rota e telas
- `GET /dashboard` (exige login; sem sessão redireciona ao login, como o painel). Link "Dashboard" no
  painel e "Painel" no dashboard.
- Mês de referência = mês atual (`mesAtual(agora)`, offset fixo -03:00 de `period.ts`).
- **Cartões:** Saldo (receitas − despesas), Receitas, Despesas. Cada um mostra a variação % sobre o mês
  anterior. Mês anterior zerado: mostra "—" em vez de dividir por zero.
- **Tendência:** barras agrupadas receitas × despesas, últimos 6 meses terminando no atual. Meses sem
  lançamentos aparecem com valor 0.
- **Categorias:** barras horizontais das despesas do mês em ordem decrescente; as 7 maiores e o restante
  agrupado em "Outras".
- **Vazio:** sem lançamentos no período, mensagem orientando a registrar pelo grupo do WhatsApp.
- **Dev:** seletor (`<select>` num `<form method="get">`, sem JS) com "Todas as contas" e as contas
  cadastradas. A conta selecionada vem no `?conta=`, validada contra a lista de contas.

## Dados
- `Repo` ganha `serieMensal(ate: Date, meses: number): Promise<{ ano: number; mes: number; receitas: number; despesas: number }[]>`.
  Uma query com `GROUP BY` por mês local (-03:00) e `tipo`, preenchendo os meses vazios com 0 no código.
- Categorias do mês e mês anterior usam o `balancete(intervalo)` existente.
- `repoDe(contaId: string | null)`: `null` = todas as contas (`($1::text IS NULL OR conta_id = $1)`). Só
  `/dashboard` do dev passa `null`; o bot e os comandos continuam sempre com um `contaId`.
- Valores em centavos (`BIGINT`), como hoje; formatação reaproveita `money.ts`.

## Código
- `src/dashboard.ts` (novo): funções puras. `montarIndicadores(serie, balanceteMes)` devolve o modelo
  (cartões, variações, categorias com "Outras") e `svgTendencia` / `svgCategorias` geram os SVGs.
  Sem acesso a banco nem a `req`.
- `src/paginas.ts`: `paginaDashboard(...)` só monta o HTML.
- `src/web.ts`: rota, checagem de acesso e escolha do `contaId` (sessão ou `?conta=` se dev).
- `src/repo.ts` e `tests/memoryRepo.ts`: `serieMensal`; `null` = todas só no Pg (o memory repo é por conta).

## Visual e acessibilidade
- Reusa as variáveis CSS e a fonte atuais (claro/escuro). Acrescenta `--receita` e `--despesa`, cada uma com
  valor nos dois temas, `--despesa` num tom distinto de `--marca` para o gráfico não parecer um botão.
- A cor nunca é a única informação: receitas com barra cheia e despesas com hachura (`<pattern>` SVG); valor
  escrito em cada barra; cada gráfico com `role="img"`, `<title>` e uma tabela de dados em `<details>`.
- Seta de variação em SVG + texto ("+12% vs. mês anterior"); a cor da seta segue o significado
  (despesa subindo não é "bom"), não o sinal.
- Mobile-first: cartões empilhados, 3 colunas a partir de ~640px; SVGs com `viewBox` a 100% da largura,
  sem scroll horizontal. Contraste mínimo 4,5:1 nos dois temas; sem emoji como ícone.

## Testes
- `dashboard.test.ts`: variação com mês anterior zerado, agrupamento em "Outras", SVG com dados vazios.
- `repo.contract.ts`: `serieMensal` (meses vazios, ignora desfeitos, fronteira do mês em -03:00); roda em
  memória e Postgres.
- `pgRepo.test.ts`: `repoDe(null)` soma contas diferentes.
- `web.test.ts`: sem login → login; usuário A não vê dados do B mesmo forjando `?conta=`; dev vê todas e
  escolhe uma; admin comum não ganha acesso a outras contas.
