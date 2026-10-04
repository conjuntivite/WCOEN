import { describe, expect, it } from 'vitest'
import { montarIndicadores, svgLinhaSaldo, svgPizza, svgTendencia } from '../src/dashboard'
import type { MesSerie } from '../src/types'

const m = (mes: number, receitas: number, despesas: number): MesSerie => ({ ano: 2026, mes, receitas, despesas })
const vazio = { receitas: [], despesas: [] }

describe('montarIndicadores', () => {
  it('calcula saldo e variação % sobre o mês anterior', () => {
    const i = montarIndicadores([m(8, 1000, 500), m(9, 1500, 250)], vazio)
    expect(i.saldo).toBe(1250)
    expect(i.variacao).toEqual({ saldo: 150, receitas: 50, despesas: -50 }) // saldo: 500 -> 1250
  })

  it('mês anterior zerado vira null (nunca Infinity)', () => {
    const i = montarIndicadores([m(8, 0, 0), m(9, 1000, 200)], vazio)
    expect(i.variacao).toEqual({ saldo: null, receitas: null, despesas: null })
  })

  it('série de um mês só não quebra', () => {
    expect(montarIndicadores([m(9, 1000, 200)], vazio).variacao.receitas).toBeNull()
  })

  it('agrupa da 6ª categoria em diante em "Outras", com % sobre o total', () => {
    const despesas = Array.from({ length: 7 }, (_, k) => ({ conta: `c${k}`, total: (7 - k) * 100 })) // 700..100, total 2800
    const i = montarIndicadores([m(9, 0, 2800)], { receitas: [], despesas })
    expect(i.categorias).toHaveLength(6)
    expect(i.categorias[0]).toEqual({ conta: 'c0', total: 700, pct: 25 })
    expect(i.categorias[5]).toEqual({ conta: 'Outras', total: 300, pct: 11 }) // 200 + 100
  })

  it('agrupa as receitas por categoria do mesmo jeito', () => {
    const i = montarIndicadores([m(9, 1000, 0)], { receitas: [{ conta: 'salário', total: 750 }, { conta: 'freela', total: 250 }], despesas: [] })
    expect(i.receitasCat).toEqual([{ conta: 'salário', total: 750, pct: 75 }, { conta: 'freela', total: 250, pct: 25 }])
    expect(i.categorias).toEqual([])
  })

  it('vazio = nenhum lançamento em toda a janela', () => {
    expect(montarIndicadores([m(8, 0, 0), m(9, 0, 0)], vazio).vazio).toBe(true)
    expect(montarIndicadores([m(8, 0, 10), m(9, 0, 0)], vazio).vazio).toBe(false)
  })
})

describe('svgTendencia', () => {
  it('desenha um rótulo por mês, é acessível e não gera NaN com tudo zerado', () => {
    const svg = svgTendencia([m(4, 0, 0), m(5, 0, 0), m(6, 0, 0), m(7, 0, 0), m(8, 0, 0), m(9, 0, 0)])
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title')
    expect(svg).not.toContain('NaN')
    for (const r of ['abr', 'mai', 'jun', 'jul', 'ago', 'set']) expect(svg).toContain(`>${r}<`)
  })

  it('mostra o valor de cada barra em texto (cor não é a única informação)', () => {
    const svg = svgTendencia([m(9, 123400, 5600)])
    expect(svg).toContain('1,2k')
    expect(svg).toContain('>56<')
  })
})

const fatias = (...totais: number[]) => totais.map((total, k) => ({ conta: `c${k}`, total, pct: 0 }))
const arcos = (svg: string) => [...svg.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)"/g)].map((r) => [Number(r[1]), Number(r[2])])

describe('svgPizza', () => {
  it('uma fatia por categoria, comprimentos + vãos somando a volta inteira (100)', () => {
    const a = arcos(svgPizza(fatias(500, 300, 200), 'p', 'Despesas', 'R$ 10'))
    expect(a).toHaveLength(3)
    for (const [cheio, vazio] of a) expect(cheio + vazio).toBeCloseTo(100, 1)
    expect(a[0][0]).toBeGreaterThan(a[1][0])
  })

  it('categoria única vira círculo cheio', () => {
    expect(arcos(svgPizza(fatias(900), 'p', 'Despesas', 'R$ 9'))).toEqual([[100, 0]])
  })

  it('acessível, com id próprio e sem NaN mesmo com total zero', () => {
    const svg = svgPizza(fatias(0, 0), 'pz-desp', 'Despesas do mês', 'R$ 0')
    expect(svg).toContain('role="img"')
    expect(svg).toContain('id="pz-desp-t"')
    expect(svg).toContain('Despesas do mês')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })
})

describe('svgLinhaSaldo', () => {
  const pontos = (svg: string) => [...svg.matchAll(/<circle class="ponto( neg)?" cx="([\d.]+)" cy="([\d.]+)"/g)].map((r) => ({ neg: !!r[1], y: Number(r[3]) }))
  const zero = (svg: string) => Number(svg.match(/class="zero" x1="0" y1="([\d.]+)"/)![1])

  it('resultado negativo fica abaixo da linha do zero e marcado como negativo', () => {
    const svg = svgLinhaSaldo([m(8, 100000, 50000), m(9, 20000, 80000)]) // +500, -600
    const [a, b] = pontos(svg)
    expect(a.neg).toBe(false)
    expect(a.y).toBeLessThan(zero(svg))
    expect(b.neg).toBe(true)
    expect(b.y).toBeGreaterThan(zero(svg))
    expect(svg).toContain('>-600<')
    expect(svg).toContain('>500<')
  })

  it('rótulo curto respeita o sinal em milhares', () => {
    expect(svgLinhaSaldo([m(9, 0, 1234500)])).toContain('>-12,3k<')
  })

  it('tudo zero não gera NaN e mostra os meses', () => {
    const svg = svgLinhaSaldo([m(8, 0, 0), m(9, 0, 0)])
    expect(svg).not.toContain('NaN')
    expect(svg).toContain('>ago<')
    expect(svg).toContain('role="img"')
  })
})
