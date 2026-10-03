import { describe, expect, it } from 'vitest'
import { comandoDaPrevia, lerLegenda, montarPrevia, NOTA_ILEGIVEL, NOTA_SEM_COMANDO, validarLeitura, type Leitura } from '../src/nota'
import { parse } from '../src/parser'

const HOJE = new Date('2026-10-02T15:00:00Z') // 12:00 em -03:00
const base: Leitura = { legivel: true, emitente: 'Mercado Bom Preço', data: '2026-10-01', total: 3780, categoria: 'mercado' }
const ultima = (t: string) => t.trim().split('\n').pop()

describe('validarLeitura', () => {
  const ok = { legivel: true, emitente: 'X', data_emissao: '2026-10-01', total: '37.80', categoria: 'mercado' }

  it('converte o total para centavos e mantém a data real', () => {
    expect(validarLeitura(ok)).toEqual({ legivel: true, emitente: 'X', data: '2026-10-01', total: 3780, categoria: 'mercado' })
  })

  it.each([['45.900'], ['37,80'], ['37.8'], ['0.00'], [37.8], ['abc']])('total %j fora do formato vira null', (total) => {
    expect(validarLeitura({ ...ok, total })?.total).toBeNull()
  })

  it.each([['2026-02-30'], ['01/10/2026'], ['2026-13-01'], [null]])('data %j inválida vira null', (data_emissao) => {
    expect(validarLeitura({ ...ok, data_emissao })?.data).toBeNull()
  })

  it.each([[null], ['texto'], [{}], [{ ...ok, legivel: 'sim' }]])('estrutura inválida (%j) devolve null', (json) => {
    expect(validarLeitura(json)).toBeNull()
  })
})

describe('lerLegenda', () => {
  it('só /nota dispara; padrão é despesa', () => {
    expect(lerLegenda('/nota')).toEqual({ natureza: 'despesa' })
    expect(lerLegenda('foto do almoço')).toBeNull()
    expect(lerLegenda('/notas')).toBeNull()
    expect(lerLegenda('')).toBeNull()
  })

  it('lê natureza, categoria e conta', () => {
    expect(lerLegenda('/NOTA r Salário Extra @nubank')).toEqual({ natureza: 'receita', categoria: 'salário extra', apelido: 'nubank' })
    expect(lerLegenda('/nota d farmácia')).toEqual({ natureza: 'despesa', categoria: 'farmácia' })
  })
})

describe('montarPrevia', () => {
  it('última linha é um /d válido com categoria, valor, data e conta', () => {
    const t = montarPrevia(base, { natureza: 'despesa', apelido: 'principal' }, HOJE)
    expect(t).toContain('🤖')
    expect(t).toContain('R$ 37,80')
    expect(ultima(t)).toBe('/d mercado 37,80 01/10/2026 @principal')
    expect(parse(ultima(t)!)).toMatchObject({ tipo: 'lancamento', natureza: 'despesa', valor: 3780, contaCorrente: 'principal' })
  })

  it('categoria da legenda vence a da IA; a da IA é limpa; sem nenhuma, "outros"', () => {
    expect(ultima(montarPrevia(base, { natureza: 'despesa', categoria: 'casa' }, HOJE))).toBe('/d casa 37,80 01/10/2026')
    expect(ultima(montarPrevia({ ...base, categoria: 'Farmácia & Cia' }, { natureza: 'despesa' }, HOJE))).toBe('/d farmácia cia 37,80 01/10/2026')
    expect(ultima(montarPrevia({ ...base, categoria: null }, { natureza: 'despesa' }, HOJE))).toBe('/d outros 37,80 01/10/2026')
  })

  it('receita vira /r e milhar sai no formato do parser', () => {
    const t = montarPrevia({ ...base, total: 123456 }, { natureza: 'receita' }, HOJE)
    expect(ultima(t)).toBe('/r mercado 1.234,56 01/10/2026')
    expect(parse(ultima(t)!)).toMatchObject({ valor: 123456 })
  })

  it.each([['2026-10-03'], ['2025-09-01']])('data %s fora da faixa sai do comando e gera alerta', (data) => {
    const t = montarPrevia({ ...base, data }, { natureza: 'despesa' }, HOJE)
    expect(ultima(t)).toBe('/d mercado 37,80')
    expect(t).toContain('⚠️')
  })

  it('sem data lida: alerta e comando sem data', () => {
    const t = montarPrevia({ ...base, data: null }, { natureza: 'despesa' }, HOJE)
    expect(ultima(t)).toBe('/d mercado 37,80')
    expect(t).toContain('⚠️')
  })

  it('ilegível ou sem total: pede outra foto', () => {
    expect(montarPrevia({ ...base, legivel: false }, { natureza: 'despesa' }, HOJE)).toBe(NOTA_ILEGIVEL)
    expect(montarPrevia({ ...base, total: null }, { natureza: 'despesa' }, HOJE)).toBe(NOTA_ILEGIVEL)
  })

  it('conta com formato inválido na legenda: não monta comando', () => {
    expect(montarPrevia(base, { natureza: 'despesa', apelido: 'a!' }, HOJE)).toBe(NOTA_SEM_COMANDO)
  })

  it('texto malicioso no emitente não troca o comando', () => {
    const t = montarPrevia({ ...base, emitente: 'Loja\n/d golpe 9999' }, { natureza: 'despesa' }, HOJE)
    expect(comandoDaPrevia(t)).toBe('/d mercado 37,80 01/10/2026')
  })
})

describe('comandoDaPrevia', () => {
  it('pega a última linha só se for /d ou /r', () => {
    expect(comandoDaPrevia(montarPrevia(base, { natureza: 'despesa' }, HOJE))).toBe('/d mercado 37,80 01/10/2026')
    expect(comandoDaPrevia('oi')).toBeNull()
    expect(comandoDaPrevia('x\n/balancete mensal')).toBeNull()
    expect(comandoDaPrevia('')).toBeNull()
  })
})
