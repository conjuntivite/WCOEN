import type { Balancete, MesSerie } from './types'

export type Categoria = { conta: string; total: number; largura: number }
export type Indicadores = {
  mes: MesSerie
  saldo: number
  variacao: { saldo: number | null; receitas: number | null; despesas: number | null } // % inteiro; null = mês anterior zerado
  categorias: Categoria[]
  serie: MesSerie[]
  vazio: boolean
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const rotuloMesCurto = (m: { mes: number }) => MESES[m.mes - 1]

const MAX_CATEGORIAS = 7
const pct = (atual: number, anterior: number) => (anterior === 0 ? null : Math.round(((atual - anterior) / Math.abs(anterior)) * 100))

export function montarIndicadores(serie: MesSerie[], balanceteMes: Balancete): Indicadores {
  const mes = serie[serie.length - 1]
  const ant = serie[serie.length - 2] ?? { ...mes, receitas: 0, despesas: 0 }
  const saldo = mes.receitas - mes.despesas
  const top = balanceteMes.despesas.slice(0, MAX_CATEGORIAS)
  const resto = balanceteMes.despesas.slice(MAX_CATEGORIAS).reduce((s, l) => s + l.total, 0)
  const linhas = resto > 0 ? [...top, { conta: 'Outras', total: resto }] : top
  const maior = Math.max(1, ...linhas.map((l) => l.total))
  return {
    mes,
    saldo,
    variacao: {
      saldo: pct(saldo, ant.receitas - ant.despesas),
      receitas: pct(mes.receitas, ant.receitas),
      despesas: pct(mes.despesas, ant.despesas),
    },
    categorias: linhas.map((l) => ({ ...l, largura: Math.round((l.total / maior) * 100) })),
    serie,
    vazio: serie.every((s) => s.receitas === 0 && s.despesas === 0),
  }
}

// 1234500 centavos -> "12,3k"; 5600 -> "56"
const curto = (centavos: number) => {
  const reais = Math.round(centavos / 100)
  return reais >= 1000 ? `${(reais / 1000).toFixed(1).replace('.', ',')}k` : String(reais)
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
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t-tend"><title id="t-tend">Receitas e despesas dos últimos ${serie.length} meses, em reais</title><defs><pattern id="hachura" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="h-fundo"/><line x1="0" y1="0" x2="0" y2="6" class="h-traco"/></pattern></defs><line class="base" x1="0" y1="${base}" x2="${W}" y2="${base}"/>${grupos}</svg>`
}
