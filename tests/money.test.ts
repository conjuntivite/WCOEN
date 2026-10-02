import { describe, it, expect } from 'vitest'
import { parseValor, parseSaldo, formatValor, formatBRL } from '../src/money'

describe('parseValor', () => {
  it.each([
    ['45', 4500],
    ['45,90', 4590],
    ['45.90', 4590],
    ['45,9', 4590],
    ['0,50', 50],
    ['1.234,56', 123456],
    ['1.234', 123400],
    ['R$ 45,90', 4590],
    ['R$45,90', 4590],
  ])('lê %s como %i centavos', (entrada, esperado) => {
    expect(parseValor(entrada)).toBe(esperado)
  })

  it.each([
    ['0'], ['0,00'], ['-5'], ['abc'], ['1,234'], ['4,5,6'], [''],
    ['99999999999999999999'], // Review Focus 4: sem overflow
  ])('ignora %s', (entrada) => {
    expect(parseValor(entrada)).toBeNull()
  })
})

describe('formatação', () => {
  it('formatValor', () => {
    expect(formatValor(4590)).toBe('45,90')
    expect(formatValor(300000)).toBe('3.000,00')
    expect(formatValor(5)).toBe('0,05')
    expect(formatValor(123456789)).toBe('1.234.567,89')
    expect(formatValor(-1000)).toBe('10,00')
  })

  it('formatBRL', () => {
    expect(formatBRL(4590)).toBe('R$ 45,90')
    expect(formatBRL(-1000)).toBe('-R$ 10,00')
  })
})

describe('parseSaldo', () => {
  it.each([
    ['', 0], ['  ', 0], ['0', 0], ['0,00', 0], ['-0', 0],
    ['1500', 150000], ['1.234,56', 123456], ['12,5', 1250], ['R$ 10', 1000],
    ['-50', -5000], ['- 50,25', -5025], ['-1.000', -100000],
  ])('%j -> %j', (entrada, esperado) => {
    expect(parseSaldo(entrada)).toBe(esperado)
  })
  it.each([['abc'], ['1,234'], ['--5'], ['5-'], ['1e3']])('%j -> null', (entrada) => {
    expect(parseSaldo(entrada)).toBeNull()
  })
})
