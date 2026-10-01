import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser'

const desp = (conta: string, valor: number) => ({ tipo: 'lancamento', natureza: 'despesa', conta, valor })
const rec = (conta: string, valor: number) => ({ tipo: 'lancamento', natureza: 'receita', conta, valor })
const ontem = { tipo: 'relativa', diasAtras: 1 }

describe('parse: lançamentos (/d e /r: descrição, valor, data)', () => {
  it.each([
    ['/d mercado 45,90', desp('mercado', 4590)],
    ['/despesa mercado 45,90', desp('mercado', 4590)],
    ['/D Mercado 45,90', desp('mercado', 4590)],
    ['  /d   mercado    45  ', desp('mercado', 4500)],
    ['/d conta de luz 120', desp('conta de luz', 12000)],
    ['/d mercado R$ 45,90', desp('mercado', 4590)],
    ['/d mercado R$45,90', desp('mercado', 4590)],
    ['/r salário 3000', rec('salário', 300000)],
    ['/receita Freela 1.500,50', rec('freela', 150050)],
    ['/r salário 3000 ontem', { ...rec('salário', 300000), data: ontem }],
    ['/d mercado 45,90 hoje', { ...desp('mercado', 4590), data: { tipo: 'relativa', diasAtras: 0 } }],
    ['/d mercado 45 anteontem', { ...desp('mercado', 4500), data: { tipo: 'relativa', diasAtras: 2 } }],
    ['/r plantão 450 15/09', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9 } }],
    ['/r plantão 450 15/09/2026', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9, ano: 2026 } }],
    ['/d conta de luz 120 5/9', { ...desp('conta de luz', 12000), data: { tipo: 'dia', dia: 5, mes: 9 } }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('sem data informada, o comando não carrega data', () => {
    expect(parse('/d mercado 45,90')).not.toHaveProperty('data')
  })

  it.each([['/d'], ['/d mercado'], ['/d 45'], ['/d 45 mercado'], ['/d mercado ontem'], ['/d mercado 0'], ['/d mercado -5'], ['/d mercado 45 32/13'], ['/d mercado 45 amanhã'], ['/d mercado 45 15/09/1999'], [`/d ${'palavra '.repeat(10)}45`]])(
    'uso incorreto de /d: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'despesa' })
    },
  )

  it('uso incorreto de /r', () => {
    expect(parse('/r salário')).toEqual({ tipo: 'uso', comando: 'receita' })
  })
})

describe('parse: atalhos e outros comandos', () => {
  it.each([
    ['/desfazer', { tipo: 'desfazer' }],
    ['/Ajuda', { tipo: 'ajuda' }],
    ['/h', { tipo: 'ajuda' }],
    ['/b', { tipo: 'balancete', relatorio: 'hoje' }],
    ['/b mensal', { tipo: 'balancete', relatorio: 'mensal' }],
    ['/e', { tipo: 'extrato', pagina: 1 }],
    ['/e 2', { tipo: 'extrato', pagina: 2 }],
    ['/a', { tipo: 'auditoria', relatorio: 'mensal' }],
    ['/a anual', { tipo: 'auditoria', relatorio: 'anual' }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })
})

describe('parse: balancete (dia, mensal, semanal e anual)', () => {
  it.each([
    ['/balancete', 'hoje'],
    ['/balancete hoje', 'hoje'],
    ['  /BALANCETE   Hoje ', 'hoje'],
    ['/balancete mensal', 'mensal'],
    ['/Balancete   Mensal ', 'mensal'],
    ['/balancete semanal', 'semanal'],
    ['  /balancete   anual  ', 'anual'],
  ])('%j', (entrada, relatorio) => {
    expect(parse(entrada)).toEqual({ tipo: 'balancete', relatorio })
  })

  it.each([['/balancete trimestre'], ['/balancete mercado'], ['/balancete 2025'], ['/balancete semana'], ['/balancete tudo'], ['/balancete mensal 3']])('uso incorreto: %j', (entrada) => {
    expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'balancete' })
  })

  it.each([
    ['/auditoria', 'mensal'],
    ['/auditoria mensal', 'mensal'],
    ['  /AUDITORIA   Semanal ', 'semanal'],
    ['/auditoria anual', 'anual'],
  ])('auditoria: %j', (entrada, relatorio) => {
    expect(parse(entrada)).toEqual({ tipo: 'auditoria', relatorio })
  })

  it.each([['/auditoria 500'], ['/auditoria trimestre'], ['/auditoria mensal 3']])('uso incorreto de auditoria: %j', (entrada) => {
    expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'auditoria' })
  })
})

describe('parse: extrato', () => {
  it.each([
    ['/extrato', 1],
    ['/EXTRATO', 1],
    ['  /extrato  ', 1],
    ['/extrato 2', 2],
    ['/Extrato   12', 12],
    ['/extrato 500', 500],
  ])('extrato: %j', (entrada, pagina) => {
    expect(parse(entrada)).toEqual({ tipo: 'extrato', pagina })
  })

  it.each([['/extrato 0'], ['/extrato abc'], ['/extrato 2 3'], ['/extrato -1'], ['/extrato 1.5'], ['/extrato mensal'], ['/extrato 1234567']])(
    'uso incorreto de extrato: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'extrato' })
    },
  )
})

describe('parse: ignorados', () => {
  it.each([
    // texto sem "/" nunca é comando
    ['oi'],
    ['mercado 45,90'],
    ['+ salário 3000'],
    ['balancete'],
    ['extrato 2'],
    ['desfazer'],
    ['ajuda'],
    ['d mercado 45'],
    [''],
    ['/'],
    ['/ d mercado 45'],
    ['/xyz'],
    ['/constructor 10'],
    ['/desfazer 10'],
    ['/ajuda 30'],
    ['/d mercado 45\n/d luz 30'], // várias linhas
    // respostas do próprio bot (anti-eco): nenhuma pode voltar a ser lida como comando
    ['🔴 *DESPESA REGISTRADA*'],
    ['🟢 Receita: plantão R$ 70,00 (09/09)'],
    ['🤖 Bot online'],
    ['📒 *Extrato · página 2/3*'],
    ['➡️ Digite */extrato 2* para continuar.'],
    ['⚠️ Use */balancete*, */balancete mensal* ou */balancete anual*.'],
    ['*12/09 às 15:05*'],
  ])('%j', (entrada) => {
    expect(parse(entrada)).toBeNull()
  })
})
