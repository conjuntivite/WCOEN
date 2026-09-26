import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser'

const desp = (conta: string, valor: number) => ({ tipo: 'lancamento', natureza: 'despesa', conta, valor })
const rec = (conta: string, valor: number) => ({ tipo: 'lancamento', natureza: 'receita', conta, valor })

describe('parse: lançamentos', () => {
  it.each([
    ['mercado 45,90', desp('mercado', 4590)],
    ['Mercado 45,90', desp('mercado', 4590)],
    ['  mercado    45  ', desp('mercado', 4500)],
    ['conta de luz 120', desp('conta de luz', 12000)],
    ['mercado R$ 45,90', desp('mercado', 4590)],
    ['mercado R$45,90', desp('mercado', 4590)],
    ['+ salário 3000', rec('salário', 300000)],
    ['+salário 3000', rec('salário', 300000)],
    ['+ Freela 1.500,50', rec('freela', 150050)],
    ['reunião às 15', desp('reunião às', 1500)], // risco conhecido da spec: vira lançamento; o usuário usa "desfazer"
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })
})

describe('parse: sinal + ou - com o valor primeiro', () => {
  it.each([
    ['+ 70 plantão', rec('plantão', 7000)],
    ['- 130 role na avenida', desp('role na avenida', 13000)],
    ['+70 plantão', rec('plantão', 7000)],
    ['-130 role', desp('role', 13000)],
    ['-  130   Role  Na  Avenida ', desp('role na avenida', 13000)],
    ['+ 1.234,56 freela', rec('freela', 123456)],
    ['- R$ 45,90 mercado', desp('mercado', 4590)],
    // com "-" o valor também pode vir por último (simetria com o "+")
    ['- mercado 45,90', desp('mercado', 4590)],
    ['-mercado 45', desp('mercado', 4500)],
    // data opcional continua valendo no fim
    ['+ 70 plantão ontem', { ...rec('plantão', 7000), data: { tipo: 'relativa', diasAtras: 1 } }],
    ['- 130 role 15/09', { ...desp('role', 13000), data: { tipo: 'dia', dia: 15, mes: 9 } }],
    ['+ plantão 450 ontem', { ...rec('plantão', 45000), data: { tipo: 'relativa', diasAtras: 1 } }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('sem sinal o valor continua sendo o último termo', () => {
    expect(parse('130 role')).toBeNull() // conta precisa começar com letra
    expect(parse('mercado 130')).toEqual(desp('mercado', 13000))
  })
})

describe('parse: outros comandos', () => {
  it.each([
    ['balancete', { tipo: 'balancete', periodo: { tipo: 'mes-atual' } }],
    ['BALANCETE tudo', { tipo: 'balancete', periodo: { tipo: 'tudo' } }],
    ['balancete 08/2026', { tipo: 'balancete', periodo: { tipo: 'mes', ano: 2026, mes: 8 } }],
    ['desfazer', { tipo: 'desfazer' }],
    ['Ajuda', { tipo: 'ajuda' }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })
})

describe('parse: data retroativa e semana', () => {
  it.each([
    ['+ plantão 450 ontem', { ...rec('plantão', 45000), data: { tipo: 'relativa', diasAtras: 1 } }],
    ['mercado 45,90 hoje', { ...desp('mercado', 4590), data: { tipo: 'relativa', diasAtras: 0 } }],
    ['mercado 45 anteontem', { ...desp('mercado', 4500), data: { tipo: 'relativa', diasAtras: 2 } }],
    ['+ plantão 450 15/09', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9 } }],
    ['+ plantão 450 15/09/2026', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9, ano: 2026 } }],
    ['conta de luz 120 5/9', { ...desp('conta de luz', 12000), data: { tipo: 'dia', dia: 5, mes: 9 } }],
    ['balancete semana', { tipo: 'balancete', periodo: { tipo: 'semana', passada: false } }],
    ['Balancete semana passada', { tipo: 'balancete', periodo: { tipo: 'semana', passada: true } }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('sem data informada, o comando não carrega data', () => {
    expect(parse('mercado 45,90')).not.toHaveProperty('data')
  })
})

describe('parse: trimestre, ano e filtros do balancete', () => {
  const mes = { tipo: 'mes-atual' }
  it.each([
    ['balancete trimestre', { tipo: 'balancete', periodo: { tipo: 'trimestre' } }],
    ['balancete ano', { tipo: 'balancete', periodo: { tipo: 'ano' } }],
    ['balancete 2025', { tipo: 'balancete', periodo: { tipo: 'ano', ano: 2025 } }],
    ['balancete receitas', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'natureza', natureza: 'receita' } }],
    ['balancete despesas', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'natureza', natureza: 'despesa' } }],
    ['balancete mercado', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'conta', conta: 'mercado' } }],
    ['Balancete Mercado', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'conta', conta: 'mercado' } }],
    ['balancete conta de luz', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'conta', conta: 'conta de luz' } }],
    ['balancete semana despesas', { tipo: 'balancete', periodo: { tipo: 'semana', passada: false }, filtro: { tipo: 'natureza', natureza: 'despesa' } }],
    ['balancete semana passada receitas', { tipo: 'balancete', periodo: { tipo: 'semana', passada: true }, filtro: { tipo: 'natureza', natureza: 'receita' } }],
    ['balancete ano mercado', { tipo: 'balancete', periodo: { tipo: 'ano' }, filtro: { tipo: 'conta', conta: 'mercado' } }],
    ['balancete 08/2026 receitas', { tipo: 'balancete', periodo: { tipo: 'mes', ano: 2026, mes: 8 }, filtro: { tipo: 'natureza', natureza: 'receita' } }],
    ['balancete trimestre conta de luz', { tipo: 'balancete', periodo: { tipo: 'trimestre' }, filtro: { tipo: 'conta', conta: 'conta de luz' } }],
    ['balancete tudo receitas', { tipo: 'balancete', periodo: { tipo: 'tudo' }, filtro: { tipo: 'natureza', natureza: 'receita' } }],
    ['balancete ia carro', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'tema', termo: 'carro' } }],
    ['Balancete IA Carro', { tipo: 'balancete', periodo: mes, filtro: { tipo: 'tema', termo: 'carro' } }],
    ['balancete ano ia carro', { tipo: 'balancete', periodo: { tipo: 'ano' }, filtro: { tipo: 'tema', termo: 'carro' } }],
    ['balancete semana passada ia conta de luz', { tipo: 'balancete', periodo: { tipo: 'semana', passada: true }, filtro: { tipo: 'tema', termo: 'conta de luz' } }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })
})

describe('parse: ignorados', () => {
  it.each([
    ['oi'],
    ['bom dia pessoal'],
    ['mercado'],
    ['45'],
    ['mercado 0'],
    ['mercado -5'],
    ['15 30'], // conta precisa começar com letra
    ['- 130'], // sinal sem descrição
    ['+ 70'],
    ['-5'],
    ['-'],
    ['+ 70 ontem'], // data sem descrição
    ['- 130 ✅ role'], // descrição precisa começar com letra
    ['+ 100 200'],
    ['- balancete 50'], // palavra reservada
    ['- comprar'], // sem valor
    ['balancete 45'], // palavra reservada
    ['desfazer 10'],
    ['ajuda 30'],
    ['balancete 13/2026'], // Review Focus 5
    ['balancete 00/1900'], // Review Focus 5
    ['mercado 45\nluz 30'], // Review Focus 1
    ['✅ Despesa: mercado R$ 45,90'], // Review Focus 2
    ['↩️ Desfeito: mercado R$ 45,90'],
    ['⚠️ Não consegui salvar, tente de novo 10'],
    [`${'palavra '.repeat(10)}45`], // conta com mais de 40 caracteres
    ['mercado ontem'], // data sem valor
    ['15/09'],
    ['mercado 45 32/13'],
    ['mercado 45 15/09/1999'],
    ['mercado 45 amanhã'],
    ['balancete semana 3'],
    ['balancete 15/09'],
    ['balancete 1999'], // ano antes de 2000
    ['balancete 2025 3'],
    ['balancete trimestre 15'],
    ['balancete ✅ mercado'], // filtro de conta precisa começar com letra
    ['balancete ia'], // "ia" sem termo
    ['balancete ia 45'],
    ['balancete ia ✅ carro'],
    [`balancete ${'palavra '.repeat(10)}`], // conta com mais de 40 caracteres
    [''],
  ])('%j', (entrada) => {
    expect(parse(entrada)).toBeNull()
  })
})
