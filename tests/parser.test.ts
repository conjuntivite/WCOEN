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

describe('parse: palavras que indicam receita (sem sinal)', () => {
  it.each([
    ['salário 3243', rec('salário', 324300)],
    ['Salario 3000', rec('salario', 300000)],
    ['plantão vogue 40', rec('plantão vogue', 4000)],
    ['décimo terceiro 1500', rec('décimo terceiro', 150000)],
    ['decimo terceiro 1500', rec('decimo terceiro', 150000)],
    ['venda beck 120', rec('venda beck', 12000)],
    ['vendas 90', rec('vendas', 9000)],
    ['freelance site 800', rec('freelance site', 80000)],
    ['freela 300', rec('freela', 30000)],
    ['comissão 250', rec('comissão', 25000)],
    ['bônus 500', rec('bônus', 50000)],
    ['reembolso 60', rec('reembolso', 6000)],
    ['rendimento 12,50', rec('rendimento', 1250)],
    ['pró-labore 4000', rec('pró-labore', 400000)],
    ['freelance site 800 ontem', { ...rec('freelance site', 80000), data: { tipo: 'relativa', diasAtras: 1 } }],
    // o sinal explícito sempre vence a palavra
    ['- salário 100', desp('salário', 10000)],
    ['- 100 salário', desp('salário', 10000)],
    ['+ mercado 50', rec('mercado', 5000)],
    ['+ salário 3000', rec('salário', 300000)],
  ])('%s', (entrada, esperado) => {
    expect(parse(entrada)).toEqual(esperado)
  })

  it.each([
    ['mercado 45'],
    ['vendaval 50'], // só vale a palavra inteira
    ['salarial 100'],
    ['pix salário 100'], // só a primeira palavra da descrição conta
    ['pagamento 100'], // palavras ambíguas ficam de fora de propósito
    ['aluguel 800'],
    ['pix 50'],
  ])('%s continua sendo despesa', (entrada) => {
    expect(parse(entrada)).toMatchObject({ tipo: 'lancamento', natureza: 'despesa' })
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

describe('parse: balancete (dia, mensal, semanal e anual)', () => {
  it.each([
    ['balancete', 'hoje'],
    ['balancete hoje', 'hoje'],
    ['  BALANCETE   Hoje ', 'hoje'],
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

  it.each([
    ['auditoria', 'mensal'],
    ['auditoria mensal', 'mensal'],
    ['  AUDITORIA   Semanal ', 'semanal'],
    ['auditoria anual', 'anual'],
  ])('auditoria: %j', (entrada, relatorio) => {
    expect(parse(entrada)).toEqual({ tipo: 'auditoria', relatorio })
  })

  it.each([['auditoria 500'], ['auditoria trimestre'], ['auditoria ia carro'], ['auditoria mensal 3']])(
    'uso incorreto de auditoria: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'auditoria' })
    },
  )

  it('auditoria continua palavra reservada: não vira despesa', () => {
    expect(parse('- auditoria 500')).toBeNull()
  })
})

describe('parse: extrato', () => {
  it.each([
    ['extrato', 1],
    ['EXTRATO', 1],
    ['  extrato  ', 1],
    ['extrato 2', 2],
    ['Extrato   12', 12],
    ['extrato 500', 500], // página, nunca despesa
  ])('extrato: %j', (entrada, pagina) => {
    expect(parse(entrada)).toEqual({ tipo: 'extrato', pagina })
  })

  it.each([['extrato 0'], ['extrato abc'], ['extrato 2 3'], ['extrato -1'], ['extrato 1.5'], ['extrato mensal'], ['extrato 1234567']])(
    'uso incorreto de extrato: %j',
    (entrada) => {
      expect(parse(entrada)).toEqual({ tipo: 'uso', comando: 'extrato' })
    },
  )

  it('extrato é palavra reservada: não vira despesa', () => {
    expect(parse('- extrato 500')).toBeNull()
  })

  it.each([
    ['📒 *Extrato · página 2/3*'],
    ['➡️ Próxima página: digite *extrato 2*'],
    ['✅ Fim do extrato'],
    ['*12/09 às 15:05*'],
    ['🔴 R$ 166,50 · luz'],
  ])('linha do próprio extrato nunca vira comando: %j', (entrada) => {
    expect(parse(entrada)).toBeNull()
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
    ['⚠️ Use *balancete*, *balancete mensal*, *balancete semanal* ou *balancete anual*.'],
    ['*15/09 às 09:30*'],
    ['🔴 R$ 45,90 · mercado'],
    ['*09/2026*'],
    ['🟢 R$ 3.000,00'],
    ['📊 *Balancete · hoje 15/09*'],
    ['📊 *Balancete mensal*'],
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

describe('parse: ambiguidade e palavras reservadas na conta', () => {
  it.each([['- 2 cafés 10'], ['+ 70 plantão 450'], ['- 50 balancete'], ['+ 10 desfazer'], ['- 50 ajuda'], ['- 50 balancete do carro']])(
    'não registra: %j',
    (entrada) => {
      expect(parse(entrada)).toBeNull()
    },
  )

  it('continuam valendo', () => {
    expect(parse('- 130 role 15/09')).toMatchObject({ conta: 'role', valor: 13000, data: { tipo: 'dia', dia: 15, mes: 9 } })
    expect(parse('- 130 role')).toMatchObject({ conta: 'role', valor: 13000 })
    expect(parse('- role 130')).toMatchObject({ conta: 'role', valor: 13000 })
    expect(parse('+ plantão 450')).toMatchObject({ natureza: 'receita', conta: 'plantão', valor: 45000 })
    expect(parse('mercado 45')).toMatchObject({ conta: 'mercado', valor: 4500 })
  })
})
