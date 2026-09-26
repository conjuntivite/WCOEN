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
    ['desfazer', { tipo: 'desfazer' }],
    ['Ajuda', { tipo: 'ajuda' }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })
})

describe('parse: data retroativa', () => {
  it.each([
    ['+ plantão 450 ontem', { ...rec('plantão', 45000), data: { tipo: 'relativa', diasAtras: 1 } }],
    ['mercado 45,90 hoje', { ...desp('mercado', 4590), data: { tipo: 'relativa', diasAtras: 0 } }],
    ['mercado 45 anteontem', { ...desp('mercado', 4500), data: { tipo: 'relativa', diasAtras: 2 } }],
    ['+ plantão 450 15/09', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9 } }],
    ['+ plantão 450 15/09/2026', { ...rec('plantão', 45000), data: { tipo: 'dia', dia: 15, mes: 9, ano: 2026 } }],
    ['conta de luz 120 5/9', { ...desp('conta de luz', 12000), data: { tipo: 'dia', dia: 5, mes: 9 } }],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it('sem data informada, o comando não carrega data', () => {
    expect(parse('mercado 45,90')).not.toHaveProperty('data')
  })
})

describe('parse: balancete mensal, semanal e anual', () => {
  it.each([
    ['balancete', 'mensal'],
    ['balancete mensal', 'mensal'],
    ['Balancete   Mensal ', 'mensal'],
    ['BALANCETE MENSAL', 'mensal'],
    ['balancete semanal', 'semanal'],
    ['Balancete SEMANAL', 'semanal'],
    ['  balancete   anual  ', 'anual'],
    ['balancete anual', 'anual'],
  ])('%j', (entrada, relatorio) => {
    expect(parse(entrada)).toEqual({ tipo: 'balancete', relatorio })
  })

  it.each([
    ['balancete trimestre'],
    ['balancete mercado'],
    ['balancete ia carro'],
    ['balancete 2025'],
    ['balancete semana'],
    ['balancete semana passada'],
    ['balancete tudo'],
    ['balancete 08/2026'],
    ['balancete mensal 3'],
    ['balancete receitas'],
  ])('uso incorreto: %j', (entrada) => {
    expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'balancete' })
  })

  it('auditoria é palavra reservada (por enquanto não é comando, e não vira despesa)', () => {
    expect(parse('auditoria')).toBeNull()
    expect(parse('auditoria 500')).toBeNull()
    expect(parse('auditoria mensal')).toBeNull()
    expect(parse('- auditoria 500')).toBeNull()
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
    ['desfazer 10'],
    ['ajuda 30'],
    ['mercado 45\nluz 30'], // Review Focus 1
    ['✅ Despesa: mercado R$ 45,90'], // Review Focus 2
    // respostas do próprio bot (anti-eco): nenhuma pode voltar a ser lida como comando
    ['🔴 Despesa: mercado R$ 45,90'],
    ['🟢 Receita: plantão R$ 70,00 (09/09)'],
    ['🔴 Despesa: role na avenida R$ 130,00'],
    ['🤖 Bot online'],
    ['🤖 Bot desligando'],
    ['🟢 Receitas: R$ 3.000,00'],
    ['🔴 Despesas: R$ 512,40'],
    ['💰 Saldo: R$ 2.487,60'],
    ['🔴 *Despesa* · mercado · R$ 45,90'],
    ['🟢 *Receita* · plantão · R$ 70,00 · 📅 09/09'],
    ['↩️ *Desfeito* · mercado · R$ 45,90'],
    ['🟢 *Receitas* — R$ 3.000,00'],
    ['🔴 *Despesas* — R$ 512,40'],
    ['💰 *Saldo: R$ 2.487,60*'],
    ['• salário — 3.000,00'],
    ['• mercado — 345,90'],
    ['📊 *Balancete mensal · 09/2026*'],
    ['📅 *Extrato*'],
    ['05/09 09:00 · 🟢 salário — R$ 3.000,00'],
    ['📈 *Últimos meses* (até 12, só com movimento)'],
    ['⚠️ Use *balancete mensal*, *balancete semanal* ou *balancete anual*.'],
    ['↩️ Desfeito: mercado R$ 45,90'],
    ['⚠️ Não consegui salvar, tente de novo 10'],
    [`${'palavra '.repeat(10)}45`], // conta com mais de 40 caracteres
    ['mercado ontem'], // data sem valor
    ['15/09'],
    ['mercado 45 32/13'],
    ['mercado 45 15/09/1999'],
    ['mercado 45 amanhã'],
    [''],
  ])('%j', (entrada) => {
    expect(parse(entrada)).toBeNull()
  })
})
