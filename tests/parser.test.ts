import { describe, it, expect } from 'vitest'
import { parse } from '../src/parser'

const desp = (conta: string, valor: number) => ({ tipo: 'lancamento', natureza: 'despesa', conta, valor })
const rec = (conta: string, valor: number) => ({ tipo: 'lancamento', natureza: 'receita', conta, valor })

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
    ['/r plantão 450 15/09', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9 } }],
    ['/r plantão 450 15/09/2026', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9, ano: 2026 } }],
    ['/d conta de luz 120 5/9', { ...desp('conta de luz', 12000), data: { tipo: 'dia', dia: 5, mes: 9 } }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('sem data informada, o comando não carrega data', () => {
    expect(parse('/d mercado 45,90')).not.toHaveProperty('data')
  })

  it.each([['/d'], ['/d mercado'], ['/d 45'], ['/d 45 mercado'], ['/d mercado ontem'], ['/d mercado 0'], ['/d mercado -5'], ['/d mercado 45 32/13'], ['/d mercado 45 amanhã'], ['/d mercado 45 hoje'], ['/d mercado 45 ontem'], ['/d mercado 45 anteontem'], ['/d mercado 45 ontem @nubank'], ['/d mercado 45 15/09/1999'], [`/d ${'palavra '.repeat(10)}45`]])(
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

describe('parse: conta corrente (@apelido)', () => {
  it.each([
    ['/d mercado 45,90 @nubank', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
    ['/d @nubank mercado 45,90', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
    ['/d mercado @nubank 45,90', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
    ['/r plantão 70 @itau-pj', { ...rec('plantão', 7000), contaCorrente: 'itau-pj' }],
    ['/d mercado 45,90 @NuBank', { ...desp('mercado', 4590), contaCorrente: 'nubank' }],
  ])('lançamento com conta: %j', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('@ convive com a data, antes ou depois dela', () => {
    expect(parse('/d mercado 45 15/09 @nubank')).toEqual({ ...desp('mercado', 4500), data: { tipo: 'dia', dia: 15, mes: 9 }, contaCorrente: 'nubank' })
    expect(parse('/d mercado 45 @nubank 15/09')).toEqual({ ...desp('mercado', 4500), data: { tipo: 'dia', dia: 15, mes: 9 }, contaCorrente: 'nubank' })
  })

  it('sem @, o resultado é o de antes (sem a chave contaCorrente)', () => {
    expect(parse('/d mercado 45,90')).toEqual(desp('mercado', 4590))
  })

  it.each([['/d mercado 45 @a @b'], ['/d mercado 45 @'], ['/d mercado 45 @com.ponto'], ['/d mercado 45 @' + 'a'.repeat(21)], ['/d mercado @nubank'], ['/d @nubank 45']])(
    'uso incorreto: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'despesa' })
    },
  )

  it.each([
    ['/b @nubank', { tipo: 'balancete', relatorio: 'hoje', contaCorrente: 'nubank' }],
    ['/b mensal @nubank', { tipo: 'balancete', relatorio: 'mensal', contaCorrente: 'nubank' }],
    ['/b @nubank anual', { tipo: 'balancete', relatorio: 'anual', contaCorrente: 'nubank' }],
    ['/e @nubank', { tipo: 'extrato', pagina: 1, contaCorrente: 'nubank' }],
    ['/e 2 @nubank', { tipo: 'extrato', pagina: 2, contaCorrente: 'nubank' }],
    ['/extrato @nubank 3', { tipo: 'extrato', pagina: 3, contaCorrente: 'nubank' }],
  ])('filtro por conta: %j', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('filtro inválido ou duplicado devolve a dica do comando; auditoria não aceita @', () => {
    expect(parse('/b @a @b')).toEqual({ tipo: 'uso', comando: 'balancete' })
    expect(parse('/e @')).toEqual({ tipo: 'uso', comando: 'extrato' })
    expect(parse('/a @nubank')).toEqual({ tipo: 'uso', comando: 'auditoria' })
  })
})

describe('parse: /contas', () => {
  it.each([['/contas'], ['/c'], ['  /Contas  ']])('%j', (entrada) => {
    expect(parse(entrada)).toEqual({ tipo: 'contas' })
  })
  it('com argumento não é comando', () => {
    expect(parse('/contas x')).toBeNull()
    expect(parse('/c @nubank')).toBeNull()
  })
})

describe('parse: transferência (/t)', () => {
  it.each([
    ['/t 500 @nubank @itau', { tipo: 'transferencia', valor: 50000, origem: 'nubank', destino: 'itau' }],
    ['/t 500 @itau', { tipo: 'transferencia', valor: 50000, destino: 'itau' }],
    ['/transferencia 1.234,56 @a @b', { tipo: 'transferencia', valor: 123456, origem: 'a', destino: 'b' }],
    ['/t @nubank 500 @itau', { tipo: 'transferencia', valor: 50000, origem: 'nubank', destino: 'itau' }],
    ['/t R$ 45,90 @itau', { tipo: 'transferencia', valor: 4590, destino: 'itau' }],
    ['/T 500 @NuBank @Itau', { tipo: 'transferencia', valor: 50000, origem: 'nubank', destino: 'itau' }],
  ])('%j', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('data opcional, antes ou depois dos @', () => {
    expect(parse('/t 500 @a @b 15/09/2026')).toEqual({ tipo: 'transferencia', valor: 50000, origem: 'a', destino: 'b', data: { tipo: 'dia', dia: 15, mes: 9, ano: 2026 } })
    expect(parse('/t 500 15/09/2026 @a @b')).toEqual({ tipo: 'transferencia', valor: 50000, origem: 'a', destino: 'b', data: { tipo: 'dia', dia: 15, mes: 9, ano: 2026 } })
    expect(parse('/t 500 @a @b ontem')).toEqual({ tipo: 'uso', comando: 'transferencia' })
    expect(parse('/t 500 @itau 15/09')).toEqual({ tipo: 'transferencia', valor: 50000, destino: 'itau', data: { tipo: 'dia', dia: 15, mes: 9, ano: undefined } })
  })

  it.each([['/t'], ['/t 500'], ['/t @a'], ['/t 500 @a @b @c'], ['/t 500 @'], ['/t abc @a'], ['/t 0 @a'], ['/t -5 @a'], ['/t 500 600 @a'], ['/t 500 @com.ponto @b'], ['/t 500 mercado @a']])(
    'uso incorreto: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'transferencia' })
    },
  )
})
