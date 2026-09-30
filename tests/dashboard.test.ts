import { describe, expect, it } from 'vitest'
import { montarIndicadores, svgTendencia } from '../src/dashboard'
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

  it('agrupa da 8ª categoria em diante em "Outras" e escala a largura pela maior', () => {
    const despesas = Array.from({ length: 9 }, (_, k) => ({ conta: `c${k}`, total: (9 - k) * 100 })) // 900..100
    const i = montarIndicadores([m(9, 0, 4500)], { receitas: [], despesas })
    expect(i.categorias).toHaveLength(8)
    expect(i.categorias[0]).toEqual({ conta: 'c0', total: 900, largura: 100 })
    expect(i.categorias[7]).toEqual({ conta: 'Outras', total: 300, largura: 33 }) // 200 + 100
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
