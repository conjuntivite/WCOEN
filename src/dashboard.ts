import type { Balancete, MesSerie } from './types'

export type Categoria = { conta: string; total: number; pct: number } // pct inteiro sobre o total do mês
export type Indicadores = {
  mes: MesSerie
  saldo: number
  variacao: { saldo: number | null; receitas: number | null; despesas: number | null } // % inteiro; null = mês anterior zerado
  categorias: Categoria[] // despesas do mês
  receitasCat: Categoria[]
  serie: MesSerie[]
  vazio: boolean
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const rotuloMesCurto = (m: { mes: number }) => MESES[m.mes - 1]

// 5 + "Outras" = 6 fatias, uma por cor da paleta (.f1..f6)
const MAX_CATEGORIAS = 5
const pct = (atual: number, anterior: number) => (anterior === 0 ? null : Math.round(((atual - anterior) / Math.abs(anterior)) * 100))

function agrupar(linhas: { conta: string; total: number }[]): Categoria[] {
  const top = linhas.slice(0, MAX_CATEGORIAS)
  const resto = linhas.slice(MAX_CATEGORIAS).reduce((s, l) => s + l.total, 0)
  const todas = resto > 0 ? [...top, { conta: 'Outras', total: resto }] : top
  const total = Math.max(1, todas.reduce((s, l) => s + l.total, 0))
  return todas.map((l) => ({ ...l, pct: Math.round((l.total / total) * 100) }))
}

export function montarIndicadores(serie: MesSerie[], balanceteMes: Balancete): Indicadores {
  const mes = serie[serie.length - 1]
  const ant = serie[serie.length - 2] ?? { ...mes, receitas: 0, despesas: 0 }
  const saldo = mes.receitas - mes.despesas
  return {
    mes,
    saldo,
    variacao: {
      saldo: pct(saldo, ant.receitas - ant.despesas),
      receitas: pct(mes.receitas, ant.receitas),
      despesas: pct(mes.despesas, ant.despesas),
    },
    categorias: agrupar(balanceteMes.despesas),
    receitasCat: agrupar(balanceteMes.receitas),
    serie,
    vazio: serie.every((s) => s.receitas === 0 && s.despesas === 0),
  }
}

// 1234500 centavos -> "12,3k"; 5600 -> "56"; -60000 -> "-600"
export const curto = (centavos: number) => {
  const reais = Math.round(Math.abs(centavos) / 100)
  return `${centavos < 0 && reais > 0 ? '-' : ''}${reais >= 1000 ? `${(reais / 1000).toFixed(1).replace('.', ',')}k` : reais}`
}

// Barras agrupadas receita (cheia) × despesa (hachurada). Cores vêm de classes/variáveis CSS da página.
export function svgTendencia(serie: MesSerie[]): string {
  const W = 360, H = 220, topo = 22, base = H - 26, alt = base - topo
  const passo = W / serie.length
  const max = Math.max(1, ...serie.flatMap((s) => [s.receitas, s.despesas]))
  const barra = (x: number, v: number, classe: string) => {
    const h = Math.round((v / max) * alt)
    return `<rect class="${classe}" x="${x}" y="${base - h}" width="24" height="${h}" rx="3"/><text class="val" x="${x + 12}" y="${base - h - 4}" text-anchor="middle">${curto(v)}</text>`
  }
  const grupos = serie
    .map((s, i) => {
      const x = Math.round(i * passo + passo / 2 - 26)
      return `${barra(x, s.receitas, 'b-rec')}${barra(x + 28, s.despesas, 'b-desp')}<text class="eixo" x="${x + 26}" y="${H - 8}" text-anchor="middle">${rotuloMesCurto(s)}</text>`
    })
    .join('')
  return `<svg class="grafico tend" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="tend-t"><title id="tend-t">Receitas e despesas dos últimos ${serie.length} meses, em reais</title><defs><pattern id="tend-hachura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="h-fundo"/><line x1="0" y1="0" x2="0" y2="6" class="h-traco"/></pattern></defs><line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>${grupos}</svg>`
}

const n2 = (v: number) => String(Math.round(v * 100) / 100)

// Donut: r = 100/2π deixa a circunferência = 100, então o traço de cada fatia é a própria %.
// Nomes e valores ficam na legenda HTML ao lado (texto, não só cor); aqui só as fatias.
export function svgPizza(fatias: Categoria[], id: string, titulo: string, centro: string): string {
  const total = fatias.reduce((s, f) => s + f.total, 0)
  const vao = fatias.filter((f) => f.total > 0).length > 1 ? 0.6 : 0 // fresta da cor do cartão entre fatias
  let feito = 0
  const arcos = total
    ? fatias
        .map((f, i) => {
          const v = (f.total / total) * 100
          const cheio = Math.max(0, v - vao)
          const arco = `<circle class="fatia f${i + 1}" cx="21" cy="21" r="15.915" stroke-dasharray="${n2(cheio)} ${n2(100 - cheio)}" stroke-dashoffset="${n2(25 - feito)}"/>`
          feito += v
          return arco
        })
        .join('')
    : ''
  return `<svg class="pizza" viewBox="0 0 42 42" role="img" aria-labelledby="${id}-t"><title id="${id}-t">${titulo}</title>${arcos || '<circle class="trilho-pizza" cx="21" cy="21" r="15.915"/>'}<text class="centro" x="21" y="22.6" text-anchor="middle">${centro}</text></svg>`
}

// Linha do resultado (receitas − despesas) mês a mês, com a linha do zero como referência.
export function svgLinhaSaldo(serie: MesSerie[]): string {
  const W = 360, H = 180, topo = 24, base = H - 34, alt = base - topo
  const vals = serie.map((s) => s.receitas - s.despesas)
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals)
  const faixa = max - min || 1
  const y = (v: number) => Math.round(topo + ((max - v) / faixa) * alt)
  const passo = W / serie.length
  const x = (i: number) => Math.round(i * passo + passo / 2)
  const linha = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const pontos = vals
    .map((v, i) => {
      const neg = v < 0
      return `<circle class="ponto${neg ? ' neg' : ''}" cx="${x(i)}" cy="${y(v)}" r="4"/><text class="val" x="${x(i)}" y="${neg ? y(v) + 16 : y(v) - 9}" text-anchor="middle">${curto(v)}</text><text class="eixo" x="${x(i)}" y="${H - 8}" text-anchor="middle">${rotuloMesCurto(serie[i])}</text>`
    })
    .join('')
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="saldo-t"><title id="saldo-t">Resultado (receitas menos despesas) dos últimos ${serie.length} meses, em reais</title><line class="zero" x1="0" y1="${y(0)}" x2="${W}" y2="${y(0)}"/><polyline class="linha" points="${linha}"/>${pontos}</svg>`
}
