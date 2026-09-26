import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Service, ERRO_SALVAR, ERRO_GENERICO, ERRO_DATA, IA_DESLIGADA, type Mensagem } from '../src/service'
import type { Auditor, DadosAuditoria } from '../src/auditar'
import { MemoryRepo } from './memoryRepo'
import type { Repo } from '../src/types'

let n = 0
const msg = (texto: string, enviadoEm = '2026-09-10T12:00:00Z', msgId = `m${++n}`): Mensagem => ({
  msgId,
  remetente: 'u@s.whatsapp.net',
  texto,
  enviadoEm: new Date(enviadoEm),
})
const agora = () => new Date('2026-09-15T12:00:00Z')
const novoService = () => new Service(new MemoryRepo(), agora)

describe('Service: lançamentos', () => {
  it('registra despesa e confirma', async () => {
    const r = await novoService().handle(msg('mercado 45,90'))
    expect(r).toEqual({ texto: '🔴 *Despesa* · mercado · R$ 45,90', lancou: true })
  })

  it('registra receita e confirma', async () => {
    const r = await novoService().handle(msg('+ salário 3000'))
    expect(r).toEqual({ texto: '🟢 *Receita* · salário · R$ 3.000,00', lancou: true })
  })

  it('palavra de receita sem sinal (salário) registra receita; o sinal "-" força despesa', async () => {
    const s = novoService()
    expect((await s.handle(msg('salário 3243')))?.texto).toBe('🟢 *Receita* · salário · R$ 3.243,00')
    expect((await s.handle(msg('- salário 100')))?.texto).toBe('🔴 *Despesa* · salário · R$ 100,00')
  })

  it('ignora texto que não é comando', async () => {
    expect(await novoService().handle(msg('bom dia pessoal'))).toBeNull()
  })

  it('mesmo msgId não lança duas vezes', async () => {
    const s = novoService()
    expect(await s.handle(msg('mercado 10', undefined, 'x1'))).not.toBeNull()
    expect(await s.handle(msg('mercado 10', undefined, 'x1'))).toBeNull()
  })
})

describe('Service: desfazer', () => {
  it('desfaz o último e depois avisa que não há mais nada', async () => {
    const s = novoService()
    await s.handle(msg('mercado 45,90'))
    expect((await s.handle(msg('desfazer')))?.texto).toBe('↩️ *Desfeito* · mercado · R$ 45,90')
    expect((await s.handle(msg('desfazer')))?.texto).toBe('↩️ Nada para desfazer.')
  })

  it('desfazer reentregue (mesmo msgId) desfaz só uma vez', async () => {
    // Review Focus 3
    const s = novoService()
    await s.handle(msg('mercado 10'))
    await s.handle(msg('luz 20'))
    expect((await s.handle(msg('desfazer', undefined, 'd1')))?.texto).toBe('↩️ *Desfeito* · luz · R$ 20,00')
    expect(await s.handle(msg('desfazer', undefined, 'd1'))).toBeNull()
    expect((await s.handle(msg('desfazer')))?.texto).toBe('↩️ *Desfeito* · mercado · R$ 10,00')
  })
})

const USO_AUDITORIA = '⚠️ Use *auditoria mensal*, *auditoria semanal* ou *auditoria anual*.'
const USO_BALANCETE = '⚠️ Use *balancete mensal*, *balancete semanal* ou *balancete anual*.'

describe('Service: balancete mensal', () => {
  async function comDados() {
    const s = novoService()
    await s.handle(msg('+ salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z')) // fora de setembro
    return s
  }
  const esperado = [
    '📊 *Balancete mensal · 09/2026*',
    '',
    '📅 *Extrato*',
    '*05/09 às 09:00*',
    '🟢 R$ 3.000,00 · salário',
    '*10/09 às 12:30*',
    '🔴 R$ 345,90 · mercado',
    '*12/09 às 15:05*',
    '🔴 R$ 166,50 · luz',
    '',
    '🟢 *Receitas* — R$ 3.000,00',
    '🔴 *Despesas* — R$ 512,40',
    '💰 *Saldo: R$ 2.487,60*',
    '',
    '📈 *Últimos meses* (até 12, só com movimento)',
    '*09/2026*',
    '🟢 3.000,00',
    '🔴 512,40',
    '💰 2.487,60',
    '*08/2026*',
    '🟢 0,00',
    '🔴 10,00',
    '💰 -10,00',
  ].join('\n')

  it('balancete = balancete mensal: extrato, totais e resumo', async () => {
    const s = await comDados()
    const r = await s.handle(msg('balancete'))
    expect(r?.texto).toBe(esperado)
    expect(r?.lancou).toBe(false)
    expect((await s.handle(msg('Balancete   Mensal ')))?.texto).toBe(esperado)
  })

  it('mês sem lançamentos mas com histórico: só a frase e o resumo', async () => {
    const s = novoService()
    await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z'))
    expect((await s.handle(msg('balancete')))?.texto).toBe(
      [
        '📊 *Balancete mensal · 09/2026*',
        '',
        '📅 *Extrato*',
        'Sem lançamentos neste mês.',
        '',
        '📈 *Últimos meses* (até 12, só com movimento)',
        '*08/2026*',
        '🟢 0,00',
        '🔴 10,00',
        '💰 -10,00',
      ].join('\n'),
    )
  })

  it('nenhum lançamento: só cabeçalho e a frase', async () => {
    expect((await novoService().handle(msg('balancete mensal')))?.texto).toBe(
      '📊 *Balancete mensal · 09/2026*\n\n📅 *Extrato*\nSem lançamentos neste mês.',
    )
  })

  it('lançamento desfeito não aparece no extrato, nos totais nem no resumo', async () => {
    const s = novoService()
    await s.handle(msg('mercado 10', '2026-09-10T12:00:00Z'))
    await s.handle(msg('luz 20', '2026-09-11T12:00:00Z'))
    await s.handle(msg('desfazer', '2026-09-11T13:00:00Z'))
    const t = (await s.handle(msg('balancete')))?.texto
    expect(t).not.toContain('luz')
    expect(t).toContain('🔴 *Despesas* — R$ 10,00')
    expect(t).toContain('*09/2026*\n🟢 0,00\n🔴 10,00\n💰 -10,00')
  })

  it('lançamento retroativo aparece no dia informado, com a hora do envio', async () => {
    const s = novoService()
    await s.handle(msg('+ plantão 450 01/09', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('balancete')))?.texto).toContain('*01/09 às 09:00*\n🟢 R$ 450,00 · plantão')
  })

  it('resumo de meses atravessa a virada de ano', async () => {
    const s = new Service(new MemoryRepo(), () => new Date('2026-01-10T12:00:00Z'))
    await s.handle(msg('mercado 10', '2025-12-20T12:00:00Z'))
    await s.handle(msg('luz 5', '2026-01-05T12:00:00Z'))
    expect((await s.handle(msg('balancete')))?.texto).toBe(
      [
        '📊 *Balancete mensal · 01/2026*',
        '',
        '📅 *Extrato*',
        '*05/01 às 09:00*',
        '🔴 R$ 5,00 · luz',
        '',
        '🟢 *Receitas* — R$ 0,00',
        '🔴 *Despesas* — R$ 5,00',
        '💰 *Saldo: -R$ 5,00*',
        '',
        '📈 *Últimos meses* (até 12, só com movimento)',
        '*01/2026*',
        '🟢 0,00',
        '🔴 5,00',
        '💰 -5,00',
        '*12/2025*',
        '🟢 0,00',
        '🔴 10,00',
        '💰 -10,00',
      ].join('\n'),
    )
  })

  it('resumo só cobre 12 meses', async () => {
    const s = novoService()
    await s.handle(msg('mercado 10', '2025-10-10T12:00:00Z')) // 11 meses atrás: entra
    await s.handle(msg('luz 20', '2025-09-10T12:00:00Z')) // 12 meses atrás: fora
    const t = (await s.handle(msg('balancete')))?.texto
    expect(t).toContain('*10/2025*\n🟢 0,00\n🔴 10,00')
    expect(t).not.toContain('09/2025')
  })
})

describe('Service: balancete semanal (domingo a sábado)', () => {
  it('semana atual + últimas 4 semanas, sem as vazias', async () => {
    const s = novoService() // agora = terça 15/09/2026: semana 13/09 a 19/09
    await s.handle(msg('mercado 10', '2026-09-14T12:00:00Z'))
    await s.handle(msg('luz 20', '2026-09-12T12:00:00Z'))
    await s.handle(msg('gas 30', '2026-08-31T12:00:00Z'))
    expect((await s.handle(msg('balancete semanal')))?.texto).toBe(
      [
        '📊 *Balancete semanal · 13/09 a 19/09*',
        '',
        '📅 *Extrato*',
        '*14/09 às 09:00*',
        '🔴 R$ 10,00 · mercado',
        '',
        '🟢 *Receitas* — R$ 0,00',
        '🔴 *Despesas* — R$ 10,00',
        '💰 *Saldo: -R$ 10,00*',
        '',
        '📈 *Últimas 4 semanas* (só com movimento)',
        '*13/09 a 19/09*',
        '🟢 0,00',
        '🔴 10,00',
        '💰 -10,00',
        '*06/09 a 12/09*',
        '🟢 0,00',
        '🔴 20,00',
        '💰 -20,00',
        '*30/08 a 05/09*',
        '🟢 0,00',
        '🔴 30,00',
        '💰 -30,00',
      ].join('\n'),
    )
  })

  it('semana sem lançamentos', async () => {
    const s = novoService()
    expect((await s.handle(msg('balancete semanal')))?.texto).toBe(
      '📊 *Balancete semanal · 13/09 a 19/09*\n\n📅 *Extrato*\nSem lançamentos nesta semana.',
    )
    await s.handle(msg('luz 20', '2026-09-12T12:00:00Z'))
    expect((await s.handle(msg('balancete semanal')))?.texto).toBe(
      [
        '📊 *Balancete semanal · 13/09 a 19/09*',
        '',
        '📅 *Extrato*',
        'Sem lançamentos nesta semana.',
        '',
        '📈 *Últimas 4 semanas* (só com movimento)',
        '*06/09 a 12/09*',
        '🟢 0,00',
        '🔴 20,00',
        '💰 -20,00',
      ].join('\n'),
    )
  })
})

describe('Service: balancete anual', () => {
  it('ano atual por mês + últimos 5 anos, sem os vazios', async () => {
    const s = novoService()
    await s.handle(msg('+ salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('mercado 10', '2025-12-31T12:00:00Z'))
    await s.handle(msg('gas 5', '2021-03-10T12:00:00Z')) // fora dos 5 anos
    expect((await s.handle(msg('balancete anual')))?.texto).toBe(
      [
        '📊 *Balancete anual · 2026*',
        '',
        '📅 *Por mês*',
        '*09/2026*',
        '🟢 3.000,00',
        '🔴 512,40',
        '💰 2.487,60',
        '',
        '🟢 *Receitas* — R$ 3.000,00',
        '🔴 *Despesas* — R$ 512,40',
        '💰 *Saldo: R$ 2.487,60*',
        '',
        '📈 *Últimos 5 anos* (só com movimento)',
        '*2026*',
        '🟢 3.000,00',
        '🔴 512,40',
        '💰 2.487,60',
        '*2025*',
        '🟢 0,00',
        '🔴 10,00',
        '💰 -10,00',
      ].join('\n'),
    )
  })

  it('meses do ano em ordem crescente; ano sem lançamentos mostra a frase', async () => {
    const s = novoService()
    await s.handle(msg('mercado 10', '2026-03-10T12:00:00Z'))
    await s.handle(msg('luz 20', '2026-01-10T12:00:00Z'))
    const t = (await s.handle(msg('balancete anual')))?.texto
    expect(t).toContain('📅 *Por mês*\n*01/2026*\n🟢 0,00\n🔴 20,00\n💰 -20,00\n*03/2026*\n🟢 0,00\n🔴 10,00\n💰 -10,00\n\n')
    expect((await novoService().handle(msg('balancete anual')))?.texto).toBe(
      '📊 *Balancete anual · 2026*\n\n📅 *Por mês*\nSem lançamentos neste ano.',
    )
  })
})

describe('Service: uso incorreto do balancete', () => {
  it.each([['balancete mercado'], ['balancete ia carro'], ['balancete trimestre'], ['balancete 2025'], ['balancete semana']])(
    '%s',
    async (texto) => {
      expect(await novoService().handle(msg(texto))).toEqual({ texto: USO_BALANCETE, lancou: false })
    },
  )
})

describe('Service: data do lançamento', () => {
  it('sem data informada, vale a data de envio da mensagem', async () => {
    const s = novoService()
    // enviada em 31/08 (antes do "agora" de setembro): cai em agosto, e a confirmação não mostra data
    const r = await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z'))
    expect(r?.texto).toBe('🔴 *Despesa* · mercado · R$ 10,00')
    const b = (await s.handle(msg('balancete')))?.texto
    expect(b).toContain('Sem lançamentos neste mês.')
    expect(b).toContain('*08/2026*\n🟢 0,00\n🔴 10,00')
  })

  it('com data informada, lança nela e mostra o dia na confirmação', async () => {
    const s = novoService() // mensagens enviadas em 10/09/2026
    expect((await s.handle(msg('+ plantão 450 ontem')))?.texto).toBe('🟢 *Receita* · plantão · R$ 450,00 · 📅 09/09')
    expect((await s.handle(msg('mercado 10 31/08')))?.texto).toBe('🔴 *Despesa* · mercado · R$ 10,00 · 📅 31/08')
    const b = (await s.handle(msg('balancete')))?.texto
    expect(b).toContain('*09/09 às 09:00*\n🟢 R$ 450,00 · plantão') // data do lançamento, hora do envio
    expect(b).toContain('*08/2026*\n🟢 0,00\n🔴 10,00')
  })

  it('sem ano e no futuro assume o ano anterior', async () => {
    const r = await novoService().handle(msg('mercado 10 25/09'))
    expect(r?.texto).toBe('🔴 *Despesa* · mercado · R$ 10,00 · 📅 25/09')
  })

  it('recusa data no futuro ou inexistente, sem lançar', async () => {
    // Review Focus 5
    const s = novoService()
    expect(await s.handle(msg('mercado 10 25/09/2026'))).toEqual({ texto: ERRO_DATA, lancou: false })
    expect((await s.handle(msg('mercado 10 29/02/2026')))?.texto).toBe(ERRO_DATA)
    expect((await s.handle(msg('balancete')))?.texto).toContain('Sem lançamentos neste mês.')
  })

  it('desfazer desfaz o último enviado, não o de data mais recente', async () => {
    // Review Focus 5
    const s = novoService()
    await s.handle(msg('mercado 10', '2026-09-10T11:00:00Z'))
    await s.handle(msg('+ plantão 450 01/09', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('desfazer', '2026-09-10T13:00:00Z')))?.texto).toBe('↩️ *Desfeito* · plantão · R$ 450,00')
  })
})

describe('Service: auditoria', () => {
  const sugestoes = ['Reduza os gastos com mercado', 'Monte uma reserva']
  const auditorFalso = (r: string[] | Error = sugestoes) => ({
    sugerir: vi.fn(async (_dados: DadosAuditoria) => {
      if (r instanceof Error) throw r
      return r
    }),
  })
  const novo = (auditor?: Auditor) => new Service(new MemoryRepo(), agora, auditor)
  async function comDados(s: Service) {
    await s.handle(msg('+ salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z')) // mês anterior
    return s
  }
  const golden = [
    '🔎 *Auditoria mensal · 09/2026*',
    '',
    '🟢 *Receitas* — R$ 3.000,00',
    '🔴 *Despesas* — R$ 512,40',
    '💰 *Saldo: R$ 2.487,60*',
    '',
    '🏆 *Maiores gastos*',
    '1. mercado — R$ 345,90 (68%)',
    '2. luz — R$ 166,50 (32%)',
    '',
    '📉 *Comparado a 08/2026*',
    '🟢 Receitas: R$ 0,00 → R$ 3.000,00',
    '🔴 Despesas: R$ 10,00 → R$ 512,40 (+5024%)',
    '💰 Saldo: -R$ 10,00 → R$ 2.487,60',
  ].join('\n')
  const indisponivel = `${golden}\n\n💡 *Sugestões da IA*\nIndisponível agora, tente de novo.`

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('auditoria = auditoria mensal: relatório calculado em código + sugestões da IA', async () => {
    const s = await comDados(novo(auditorFalso()))
    const esperado = `${golden}\n\n💡 *Sugestões da IA*\n• Reduza os gastos com mercado\n• Monte uma reserva`
    const r = await s.handle(msg('auditoria'))
    expect(r?.texto).toBe(esperado)
    expect(r?.lancou).toBe(false)
    expect((await s.handle(msg(' Auditoria   MENSAL ')))?.texto).toBe(esperado)
  })

  it('a IA recebe só DadosAuditoria, com tudo já calculado e formatado', async () => {
    const auditor = auditorFalso()
    const s = await comDados(novo(auditor))
    await s.handle(msg('auditoria'))
    expect(auditor.sugerir).toHaveBeenCalledTimes(1)
    expect(auditor.sugerir.mock.calls[0][0]).toEqual({
      periodo: '09/2026',
      receitas: 'R$ 3.000,00',
      despesas: 'R$ 512,40',
      saldo: 'R$ 2.487,60',
      rankingDespesas: [
        { conta: 'mercado', valor: 'R$ 345,90', percentual: 68 },
        { conta: 'luz', valor: 'R$ 166,50', percentual: 32 },
      ],
      receitasPorConta: [{ conta: 'salário', valor: 'R$ 3.000,00' }],
      comparacao: { periodo: '08/2026', receitas: 'R$ 0,00', despesas: 'R$ 10,00', saldo: '-R$ 10,00' },
      lancamentos: [
        { data: '05/09/2026', tipo: 'receita', conta: 'salário', valor: 'R$ 3.000,00' },
        { data: '10/09/2026', tipo: 'despesa', conta: 'mercado', valor: 'R$ 345,90' },
        { data: '12/09/2026', tipo: 'despesa', conta: 'luz', valor: 'R$ 166,50' },
      ],
    })
  })

  it('ranking com no máximo 5 contas e lançamentos limitados aos 200 mais recentes', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) await s.handle(msg(`${c} 10`, '2026-09-10T12:00:00Z'))
    for (let i = 0; i < 200; i++) await s.handle(msg('g 1', '2026-09-11T12:00:00Z'))
    await s.handle(msg('auditoria'))
    const dados = auditor.sugerir.mock.calls[0][0]
    expect(dados.rankingDespesas).toHaveLength(5)
    expect(dados.lancamentos).toHaveLength(200)
    expect(dados.lancamentos.every((l) => l.conta === 'g')).toBe(true) // os mais recentes ficam
  })

  it('sem movimento no período anterior: omite o bloco de comparação', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    await s.handle(msg('mercado 10', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('auditoria')))?.texto
    expect(t).not.toContain('📉')
    expect(t).toContain('1. mercado — R$ 10,00 (100%)')
    expect(auditor.sugerir.mock.calls[0][0].comparacao).toBeUndefined()
  })

  it('variação de despesas só com base anterior maior que zero', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('+ freela 100', '2026-08-10T12:00:00Z')) // anterior sem despesas
    await s.handle(msg('mercado 10', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('auditoria')))?.texto
    expect(t).toContain('🔴 Despesas: R$ 0,00 → R$ 10,00\n')
    expect(t).not.toMatch(/Despesas: .*%/)
  })

  it('variação negativa', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('mercado 40', '2026-08-10T12:00:00Z'))
    await s.handle(msg('mercado 10', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('auditoria')))?.texto).toContain('🔴 Despesas: R$ 40,00 → R$ 10,00 (-75%)')
  })

  it('sem lançamentos no período: frase única, sem chamar a IA', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z'))
    expect((await s.handle(msg('auditoria')))?.texto).toBe('🔎 *Auditoria mensal · 09/2026*\n\nSem lançamentos no período.')
    expect(auditor.sugerir).not.toHaveBeenCalled()
  })

  it('sem auditor configurado: título e o aviso de IA desligada', async () => {
    const s = await comDados(novo())
    expect((await s.handle(msg('auditoria')))?.texto).toBe(`🔎 *Auditoria mensal · 09/2026*\n\n${IA_DESLIGADA}`)
  })

  it('auditor falha: relatório calculado sai com "Indisponível" e o erro só vai para o log', async () => {
    const s = await comDados(novo(auditorFalso(new Error('OpenRouter (x) respondeu 500'))))
    expect((await s.handle(msg('auditoria')))?.texto).toBe(indisponivel)
    expect(console.error).toHaveBeenCalled()
  })

  it('auditor devolve lista vazia: também "Indisponível"', async () => {
    const s = await comDados(novo(auditorFalso([])))
    expect((await s.handle(msg('auditoria')))?.texto).toBe(indisponivel)
  })

  it('auditoria semanal (domingo a sábado) compara com a semana anterior', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    await s.handle(msg('+ plantão 100', '2026-09-14T12:00:00Z'))
    await s.handle(msg('mercado 30', '2026-09-15T12:00:00Z'))
    await s.handle(msg('mercado 50', '2026-09-08T12:00:00Z'))
    expect((await s.handle(msg('auditoria semanal')))?.texto).toBe(
      [
        '🔎 *Auditoria semanal · 13/09 a 19/09*',
        '',
        '🟢 *Receitas* — R$ 100,00',
        '🔴 *Despesas* — R$ 30,00',
        '💰 *Saldo: R$ 70,00*',
        '',
        '🏆 *Maiores gastos*',
        '1. mercado — R$ 30,00 (100%)',
        '',
        '📉 *Comparado a 06/09 a 12/09*',
        '🟢 Receitas: R$ 0,00 → R$ 100,00',
        '🔴 Despesas: R$ 50,00 → R$ 30,00 (-40%)',
        '💰 Saldo: -R$ 50,00 → R$ 70,00',
        '',
        '💡 *Sugestões da IA*',
        '• Reduza os gastos com mercado',
        '• Monte uma reserva',
      ].join('\n'),
    )
    expect(auditor.sugerir.mock.calls[0][0].periodo).toBe('13/09 a 19/09')
  })

  it('auditoria anual compara com o ano anterior', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('mercado 200', '2026-03-10T12:00:00Z'))
    await s.handle(msg('mercado 100', '2025-05-10T12:00:00Z'))
    const t = (await s.handle(msg('auditoria anual')))?.texto
    expect(t).toContain('🔎 *Auditoria anual · 2026*')
    expect(t).toContain('📉 *Comparado a 2025*')
    expect(t).toContain('🔴 Despesas: R$ 100,00 → R$ 200,00 (+100%)')
  })

  it('só receitas no período: sem ranking de gastos', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('+ salário 100', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('auditoria')))?.texto
    expect(t).not.toContain('🏆')
    expect(t).toContain('🟢 *Receitas* — R$ 100,00')
  })

  it('uso incorreto responde a dica', async () => {
    expect((await novo().handle(msg('auditoria trimestre')))?.texto).toBe(USO_AUDITORIA)
  })

  it('mensagem recuperada não gera auditoria nem dica de uso', async () => {
    const auditor = auditorFalso()
    const s = await comDados(novo(auditor))
    expect(await s.handle(msg('auditoria'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('auditoria semanal'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('auditoria 500'), { recuperada: true })).toBeNull()
    expect(auditor.sugerir).not.toHaveBeenCalled()
  })
})

describe('Service: ajuda e recuperação', () => {
  it('ajuda lista os comandos', async () => {
    const r = await novoService().handle(msg('ajuda'))
    expect(r?.texto).toContain('• balancete mensal · semanal · anual → extrato + resumo')
    expect(r?.texto).toContain('• auditoria mensal · semanal · anual → ranking e dicas da IA')
    expect(r?.texto).not.toContain('trimestre')
    expect(r?.texto).toContain('desfazer')
  })

  it('mensagem recuperada grava lançamento com a data original, mas não responde balancete, uso incorreto nem ajuda', async () => {
    const s = novoService()
    expect(await s.handle(msg('balancete'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('balancete semanal'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('balancete mercado'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('ajuda'), { recuperada: true })).toBeNull()
    const r = await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z'), { recuperada: true })
    expect(r?.lancou).toBe(true)
    expect((await s.handle(msg('balancete')))?.texto).toContain('*08/2026*\n🟢 0,00\n🔴 10,00')
  })
})

describe('Service: falhas', () => {
  const quebrado: Repo = {
    add: vi.fn().mockRejectedValue(new Error('mongo fora')),
    desfazerUltimo: vi.fn().mockRejectedValue(new Error('mongo fora')),
    balancete: vi.fn().mockRejectedValue(new Error('mongo fora')),
    extrato: vi.fn().mockRejectedValue(new Error('mongo fora')),
  }

  it('não confirma com ✅ quando a gravação falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = new Service(quebrado, agora)
    expect(await s.handle(msg('mercado 10'))).toEqual({ texto: ERRO_SALVAR, lancou: false })
    expect((await s.handle(msg('desfazer')))?.texto).toBe(ERRO_SALVAR)
    expect((await s.handle(msg('balancete')))?.texto).toBe(ERRO_GENERICO)
  })

  it('mensagem que falhou pode ser tentada de novo com o mesmo msgId', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const add = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok')
    const s = new Service({ ...quebrado, add }, agora)
    expect((await s.handle(msg('mercado 10', undefined, 'r1')))?.texto).toBe(ERRO_SALVAR)
    expect((await s.handle(msg('mercado 10', undefined, 'r1')))?.lancou).toBe(true)
  })
})
