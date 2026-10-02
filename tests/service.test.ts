import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Service, POR_PAGINA, type Mensagem } from '../src/service'
import { ERRO_SALVAR, ERRO_GENERICO, ERRO_DATA, IA_DESLIGADA } from '../src/presentation'
import type { Auditor, DadosAuditoria } from '../src/auditar'
import { MemoryRepo } from './memoryRepo'
import { contasEmMemoria, PRINCIPAL } from './memoryContasCorrentes'
import type { ContaCorrenteComSaldo, Repo } from '../src/types'

let n = 0
const msg = (texto: string, enviadoEm = '2026-09-10T12:00:00Z', msgId = `m${++n}`): Mensagem => ({
  msgId,
  remetente: 'u@s.whatsapp.net',
  texto,
  enviadoEm: new Date(enviadoEm),
})
const SEP = '──────────────'
const secoes = (...b: string[]) => b.join(`\n\n${SEP}\n\n`)
const agora = () => new Date('2026-09-15T12:00:00Z')
const novoService = () => new Service(new MemoryRepo(), contasEmMemoria(), agora)

describe('Service: lançamentos', () => {
  it('registra despesa e confirma', async () => {
    const r = await novoService().handle(msg('/d mercado 45,90'))
    expect(r).toEqual({ texto: '🔴 *DESPESA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 45,90*', lancou: true })
  })

  it('registra receita e confirma', async () => {
    const r = await novoService().handle(msg('/r salário 3000'))
    expect(r).toEqual({ texto: '🟢 *RECEITA REGISTRADA*\n\n📝 _salário_\n💰 *R$ 3.000,00*', lancou: true })
  })

  it('natureza vem só do comando, nunca da palavra', async () => {
    const s = novoService()
    expect((await s.handle(msg('/d salário 100')))?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _salário_\n💰 *R$ 100,00*')
    expect((await s.handle(msg('/r mercado 50')))?.texto).toBe('🟢 *RECEITA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 50,00*')
  })

  it('texto sem "/" não é comando', async () => {
    expect(await novoService().handle(msg('mercado 45,90'))).toBeNull()
    expect(await novoService().handle(msg('bom dia pessoal'))).toBeNull()
  })

  it('lançamento incompleto responde a dica de uso, sem gravar', async () => {
    const s = novoService()
    expect(await s.handle(msg('/d mercado'))).toEqual({ texto: USO('/d mercado 45,90', '/d mercado 45,90 ontem', '/d mercado 45,90 15/09', '/d mercado 45,90 @conta'), lancou: false })
    expect((await s.handle(msg('/r salário')))?.texto).toBe(USO('/r plantão 70', '/r plantão 70 ontem', '/r plantão 70 15/09', '/r plantão 70 @conta'))
    expect((await s.handle(msg('/extrato')))?.texto).toContain('Nenhum lançamento')
  })

  it('grava o lançamento na conta corrente favorita', async () => {
    const repo = new MemoryRepo()
    await new Service(repo, contasEmMemoria(), agora).handle(msg('/d mercado 45,90'))
    const [l] = await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })
    expect(l.contaCorrenteId).toBe('cc1')
  })

  it('mesmo msgId não lança duas vezes', async () => {
    const s = novoService()
    expect(await s.handle(msg('/d mercado 10', undefined, 'x1'))).not.toBeNull()
    expect(await s.handle(msg('/d mercado 10', undefined, 'x1'))).toBeNull()
  })
})

describe('Service: desfazer', () => {
  it('desfaz o último e depois avisa que não há mais nada', async () => {
    const s = novoService()
    await s.handle(msg('/d mercado 45,90'))
    expect((await s.handle(msg('/desfazer')))?.texto).toBe('↩️ *LANÇAMENTO DESFEITO*\n\n📝 _mercado_\n💰 *R$ 45,90*')
    expect((await s.handle(msg('/desfazer')))?.texto).toBe('↩️ *NADA PARA DESFAZER*\n\n_Não há lançamentos para desfazer._')
  })

  it('desfazer reentregue (mesmo msgId) desfaz só uma vez', async () => {
    // Review Focus 3
    const s = novoService()
    await s.handle(msg('/d mercado 10'))
    await s.handle(msg('/d luz 20'))
    expect((await s.handle(msg('/desfazer', undefined, 'd1')))?.texto).toBe('↩️ *LANÇAMENTO DESFEITO*\n\n📝 _luz_\n💰 *R$ 20,00*')
    expect(await s.handle(msg('/desfazer', undefined, 'd1'))).toBeNull()
    expect((await s.handle(msg('/desfazer')))?.texto).toBe('↩️ *LANÇAMENTO DESFEITO*\n\n📝 _mercado_\n💰 *R$ 10,00*')
  })
})

const USO = (...c: string[]) => `⚠️ *COMANDO INCOMPLETO*\n\n_Use um destes:_\n\n${c.map((x) => `👉 \`${x}\``).join('\n')}`
const USO_AUDITORIA = USO('/auditoria mensal', '/auditoria semanal', '/auditoria anual')
const USO_BALANCETE = USO('/balancete', '/balancete mensal', '/balancete semanal', '/balancete anual', '/balancete @conta')
const USO_EXTRATO = USO('/extrato', '/extrato 2', '/extrato @conta')

// bloco de totais no novo formato
const tot = (r: string, d: string, saldo: string, emoji = '💚') => `🟢 Receitas\n*${r}*\n\n🔴 Despesas\n*${d}*\n\n${emoji} *SALDO*\n*${saldo}*`
const periodo = (rotulo: string, r: string, d: string, saldo: string, emoji?: string) => `📅 *${rotulo}*\n\n${tot(r, d, saldo, emoji)}`

describe('Service: balancete mensal (só resumo)', () => {
  async function comDados() {
    const s = novoService()
    await s.handle(msg('/r salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('/d mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('/d luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('/d mercado 10', '2026-08-31T12:00:00Z')) // fora de setembro
    return s
  }
  const esperado = secoes('📊 *BALANCETE MENSAL*', periodo('Setembro/2026', 'R$ 3.000,00', 'R$ 512,40', 'R$ 2.487,60'), periodo('Agosto/2026', 'R$ 0,00', 'R$ 10,00', '-R$ 10,00', '⚠️'))

  it('resumo por mês, sem extrato', async () => {
    const s = await comDados()
    const r = await s.handle(msg('/balancete mensal'))
    expect(r?.texto).toBe(esperado)
    expect(r?.lancou).toBe(false)
    expect((await s.handle(msg('/Balancete   Mensal ')))?.texto).toBe(esperado)
  })

  it('nenhum lançamento: só cabeçalho e a frase', async () => {
    expect((await novoService().handle(msg('/balancete mensal')))?.texto).toBe('📊 *BALANCETE MENSAL*\n\n_Nenhum lançamento no período._')
  })

  it('lançamento desfeito não aparece', async () => {
    const s = novoService()
    await s.handle(msg('/d mercado 10', '2026-09-10T12:00:00Z'))
    await s.handle(msg('/d luz 20', '2026-09-11T12:00:00Z'))
    await s.handle(msg('/desfazer', '2026-09-11T13:00:00Z'))
    expect((await s.handle(msg('/balancete mensal')))?.texto).toBe(
      secoes('📊 *BALANCETE MENSAL*', periodo('Setembro/2026', 'R$ 0,00', 'R$ 10,00', '-R$ 10,00', '⚠️')),
    )
  })

  it('lançamento retroativo entra no período da sua data', async () => {
    const s = novoService()
    await s.handle(msg('/r plantão 450 31/08', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('/balancete mensal')))?.texto).toBe(
      secoes('📊 *BALANCETE MENSAL*', periodo('Agosto/2026', 'R$ 450,00', 'R$ 0,00', 'R$ 450,00')),
    )
  })

  it('atravessa a virada de ano', async () => {
    const s = new Service(new MemoryRepo(), contasEmMemoria(), () => new Date('2026-01-10T12:00:00Z'))
    await s.handle(msg('/d mercado 10', '2025-12-20T12:00:00Z'))
    await s.handle(msg('/d luz 5', '2026-01-05T12:00:00Z'))
    expect((await s.handle(msg('/balancete mensal')))?.texto).toBe(
      secoes('📊 *BALANCETE MENSAL*', periodo('Janeiro/2026', 'R$ 0,00', 'R$ 5,00', '-R$ 5,00', '⚠️'), periodo('Dezembro/2025', 'R$ 0,00', 'R$ 10,00', '-R$ 10,00', '⚠️')),
    )
  })

  it('só cobre 12 meses', async () => {
    const s = novoService()
    await s.handle(msg('/d mercado 10', '2025-10-10T12:00:00Z')) // 11 meses atrás: entra
    await s.handle(msg('/d luz 20', '2025-09-10T12:00:00Z')) // 12 meses atrás: fora
    const t = (await s.handle(msg('/balancete mensal')))?.texto
    expect(t).toContain('📅 *Outubro/2025*\n\n🟢 Receitas\n*R$ 0,00*\n\n🔴 Despesas\n*R$ 10,00*')
    expect(t).not.toContain('Setembro/2025')
  })
})

describe('Service: balancete semanal (domingo a sábado)', () => {
  it('semana atual + últimas 4 semanas, sem as vazias', async () => {
    const s = novoService() // agora = terça 15/09/2026: semana 13/09 a 19/09
    await s.handle(msg('/d mercado 10', '2026-09-14T12:00:00Z'))
    await s.handle(msg('/d luz 20', '2026-09-12T12:00:00Z'))
    await s.handle(msg('/d gas 30', '2026-08-31T12:00:00Z'))
    expect((await s.handle(msg('/balancete semanal')))?.texto).toBe(
      secoes('📊 *BALANCETE SEMANAL*', periodo('13/09 a 19/09', 'R$ 0,00', 'R$ 10,00', '-R$ 10,00', '⚠️'), periodo('06/09 a 12/09', 'R$ 0,00', 'R$ 20,00', '-R$ 20,00', '⚠️'), periodo('30/08 a 05/09', 'R$ 0,00', 'R$ 30,00', '-R$ 30,00', '⚠️')),
    )
  })

  it('nenhum lançamento', async () => {
    expect((await novoService().handle(msg('/balancete semanal')))?.texto).toBe('📊 *BALANCETE SEMANAL*\n\n_Nenhum lançamento no período._')
  })
})

describe('Service: balancete anual (só resumo)', () => {
  it('últimos 5 anos, sem os vazios e sem "Por mês"', async () => {
    const s = novoService()
    await s.handle(msg('/r salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('/d mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('/d luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('/d mercado 10', '2025-12-31T12:00:00Z'))
    await s.handle(msg('/d gas 5', '2021-03-10T12:00:00Z')) // fora dos 5 anos
    expect((await s.handle(msg('/balancete anual')))?.texto).toBe(
      secoes('📊 *BALANCETE ANUAL*', periodo('2026', 'R$ 3.000,00', 'R$ 512,40', 'R$ 2.487,60'), periodo('2025', 'R$ 0,00', 'R$ 10,00', '-R$ 10,00', '⚠️')),
    )
  })

  it('nenhum lançamento', async () => {
    expect((await novoService().handle(msg('/balancete anual')))?.texto).toBe('📊 *BALANCETE ANUAL*\n\n_Nenhum lançamento no período._')
  })
})

describe('Service: balancete do dia', () => {
  it('extrato de hoje em ordem, com totais; ontem fica fora', async () => {
    const s = novoService()
    await s.handle(msg('/r plantão 450', '2026-09-15T15:05:00Z'))
    await s.handle(msg('/d mercado 45,90', '2026-09-15T12:30:00Z'))
    await s.handle(msg('/d luz 20', '2026-09-14T12:00:00Z'))
    const r = await s.handle(msg('/balancete'))
    expect(r?.texto).toBe(
      secoes(
        '📊 *BALANCETE DO DIA*\n_15/09/2026_',
        '🕐 *09:30*\n🔴 mercado\n*− R$ 45,90*\n\n🕐 *12:05*\n🟢 plantão\n*+ R$ 450,00*',
        tot('R$ 450,00', 'R$ 45,90', 'R$ 404,10'),
      ),
    )
    expect(r?.lancou).toBe(false)
    expect((await s.handle(msg('/Balancete  HOJE')))?.texto).toBe(r?.texto)
  })

  it('vazio', async () => {
    expect((await novoService().handle(msg('/balancete')))?.texto).toBe('📊 *BALANCETE DO DIA*\n_15/09/2026_\n\n_Nenhum lançamento registrado hoje._')
  })

  it('virada do dia local: 02:59Z ainda é o dia anterior', async () => {
    const antes = new Service(new MemoryRepo(), contasEmMemoria(), () => new Date('2026-09-15T02:59:00Z'))
    await antes.handle(msg('/d mercado 10', '2026-09-14T15:00:00Z'))
    expect((await antes.handle(msg('/balancete')))?.texto).toContain('_14/09/2026_')
    const depois = new Service(new MemoryRepo(), contasEmMemoria(), () => new Date('2026-09-15T03:00:00Z'))
    await depois.handle(msg('/d mercado 10', '2026-09-14T15:00:00Z'))
    expect((await depois.handle(msg('/balancete')))?.texto).toBe('📊 *BALANCETE DO DIA*\n_15/09/2026_\n\n_Nenhum lançamento registrado hoje._')
  })

  it('desfeito some', async () => {
    const s = novoService()
    await s.handle(msg('/d mercado 10', '2026-09-15T12:00:00Z'))
    await s.handle(msg('/d luz 20', '2026-09-15T13:00:00Z'))
    await s.handle(msg('/desfazer', '2026-09-15T13:30:00Z'))
    const t = (await s.handle(msg('/balancete')))?.texto
    expect(t).not.toContain('luz')
    expect(t).toContain('🔴 Despesas\n*R$ 10,00*')
  })

  it('retroativo (data de outro dia) não aparece no dia de hoje', async () => {
    const s = novoService()
    await s.handle(msg('/r plantão 450 01/09', '2026-09-15T12:00:00Z'))
    expect((await s.handle(msg('/balancete')))?.texto).toBe('📊 *BALANCETE DO DIA*\n_15/09/2026_\n\n_Nenhum lançamento registrado hoje._')
  })
})

describe('Service: uso incorreto do balancete', () => {
  it.each([['balancete mercado'], ['balancete ia carro'], ['balancete trimestre'], ['balancete 2025'], ['balancete semana']])(
    '%s',
    async (texto) => {
      expect(await novoService().handle(msg(`/${texto}`))).toEqual({ texto: USO_BALANCETE, lancou: false })
    },
  )
})

describe('Service: data do lançamento', () => {
  it('sem data informada, vale a data de envio da mensagem', async () => {
    const s = novoService()
    // enviada em 31/08 (antes do "agora" de setembro): cai em agosto, e a confirmação não mostra data
    const r = await s.handle(msg('/d mercado 10', '2026-08-31T12:00:00Z'))
    expect(r?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 10,00*')
    expect((await s.handle(msg('/balancete mensal')))?.texto).toContain('📅 *Agosto/2026*\n\n🟢 Receitas\n*R$ 0,00*\n\n🔴 Despesas\n*R$ 10,00*')
  })

  it('com data informada, lança nela e mostra o dia na confirmação', async () => {
    const s = novoService() // mensagens enviadas em 10/09/2026
    expect((await s.handle(msg('/r plantão 450 ontem')))?.texto).toBe('🟢 *RECEITA REGISTRADA*\n\n📝 _plantão_\n💰 *R$ 450,00*\n📅 _09/09_')
    expect((await s.handle(msg('/d mercado 10 31/08')))?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 10,00*\n📅 _31/08_')
    const b = (await s.handle(msg('/balancete mensal')))?.texto
    expect(b).toContain('📅 *Setembro/2026*\n\n🟢 Receitas\n*R$ 450,00*\n\n🔴 Despesas\n*R$ 0,00*')
    expect(b).toContain('📅 *Agosto/2026*\n\n🟢 Receitas\n*R$ 0,00*\n\n🔴 Despesas\n*R$ 10,00*')
  })

  it('sem ano e no futuro assume o ano anterior', async () => {
    const r = await novoService().handle(msg('/d mercado 10 25/09'))
    expect(r?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 10,00*\n📅 _25/09_')
  })

  it('recusa data no futuro ou inexistente, sem lançar', async () => {
    // Review Focus 5
    const s = novoService()
    expect(await s.handle(msg('/d mercado 10 25/09/2026'))).toEqual({ texto: ERRO_DATA, lancou: false })
    expect((await s.handle(msg('/d mercado 10 29/02/2026')))?.texto).toBe(ERRO_DATA)
    expect((await s.handle(msg('/balancete mensal')))?.texto).toBe('📊 *BALANCETE MENSAL*\n\n_Nenhum lançamento no período._')
  })

  it('desfazer desfaz o último enviado, não o de data mais recente', async () => {
    // Review Focus 5
    const s = novoService()
    await s.handle(msg('/d mercado 10', '2026-09-10T11:00:00Z'))
    await s.handle(msg('/r plantão 450 01/09', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('/desfazer', '2026-09-10T13:00:00Z')))?.texto).toBe('↩️ *LANÇAMENTO DESFEITO*\n\n📝 _plantão_\n💰 *R$ 450,00*')
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
  const novo = (auditor?: Auditor) => new Service(new MemoryRepo(), contasEmMemoria(), agora, auditor)
  async function comDados(s: Service) {
    await s.handle(msg('/r salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('/d mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('/d luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('/d mercado 10', '2026-08-31T12:00:00Z')) // mês anterior
    return s
  }
  const cab = (sub = 'Mensal · Setembro/2026') => `🔎 *AUDITORIA FINANCEIRA*\n_${sub}_`
  const resumo = (r: string, d: string, saldo: string, emoji?: string) => `📊 *RESUMO*\n\n${tot(r, d, saldo, emoji)}`
  const gastos = (...itens: string[]) => `🏆 *MAIORES GASTOS*\n\n${itens.join('\n\n')}`
  const comparacao = (ant: string, r: string, d: string, s: string, variacao = '') => `📈 *COMPARAÇÃO*\n_Período anterior: ${ant}_\n\n🟢 Receitas\n${r}\n\n🔴 Despesas\n${d}${variacao}\n\n💰 Saldo\n${s}`
  const ia = (...dicas: string[]) => `💡 *ANÁLISE DA IA*\n\n${dicas.join('\n\n')}`
  const golden = [
    cab(),
    resumo('R$ 3.000,00', 'R$ 512,40', 'R$ 2.487,60'),
    gastos('🥇 mercado\n*R$ 345,90* · _68%_', '🥈 luz\n*R$ 166,50* · _32%_'),
    comparacao('Agosto/2026', '_R$ 0,00 →_ *R$ 3.000,00*', '_R$ 10,00 →_ *R$ 512,40*', '_-R$ 10,00 →_ *R$ 2.487,60*', '\n_▲ 5024%_'),
  ]
  const indisponivel = secoes(...golden, ia('_Indisponível no momento. Tente novamente mais tarde._'))

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('auditoria = auditoria mensal: relatório calculado em código + sugestões da IA', async () => {
    const s = await comDados(novo(auditorFalso()))
    const esperado = secoes(...golden, ia('• _Reduza os gastos com mercado_', '• _Monte uma reserva_'))
    const r = await s.handle(msg('/auditoria'))
    expect(r?.texto).toBe(esperado)
    expect(r?.lancou).toBe(false)
    expect((await s.handle(msg('/Auditoria   MENSAL ')))?.texto).toBe(esperado)
  })

  it('a IA recebe só DadosAuditoria, com tudo já calculado e formatado', async () => {
    const auditor = auditorFalso()
    const s = await comDados(novo(auditor))
    await s.handle(msg('/auditoria'))
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
    for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) await s.handle(msg(`/d ${c} 10`, '2026-09-10T12:00:00Z'))
    for (let i = 0; i < 200; i++) await s.handle(msg('/d g 1', '2026-09-11T12:00:00Z'))
    await s.handle(msg('/auditoria'))
    const dados = auditor.sugerir.mock.calls[0][0]
    expect(dados.rankingDespesas).toHaveLength(5)
    expect(dados.lancamentos).toHaveLength(200)
    expect(dados.lancamentos.every((l) => l.conta === 'g')).toBe(true) // os mais recentes ficam
  })

  it('sem movimento no período anterior: omite o bloco de comparação', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    await s.handle(msg('/d mercado 10', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('/auditoria')))?.texto
    expect(t).not.toContain('📈')
    expect(t).toContain('🥇 mercado\n*R$ 10,00* · _100%_')
    expect(auditor.sugerir.mock.calls[0][0].comparacao).toBeUndefined()
  })

  it('variação de despesas só com base anterior maior que zero', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('/r freela 100', '2026-08-10T12:00:00Z')) // anterior sem despesas
    await s.handle(msg('/d mercado 10', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('/auditoria')))?.texto
    expect(t).toContain('🔴 Despesas\n_R$ 0,00 →_ *R$ 10,00*\n\n')
    expect(t).not.toMatch(/[▲▼]/)
  })

  it('variação negativa', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('/d mercado 40', '2026-08-10T12:00:00Z'))
    await s.handle(msg('/d mercado 10', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('/auditoria')))?.texto).toContain('_R$ 40,00 →_ *R$ 10,00*\n_▼ 75%_')
  })

  it('sem lançamentos no período: frase única, sem chamar a IA', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    await s.handle(msg('/d mercado 10', '2026-08-31T12:00:00Z'))
    expect((await s.handle(msg('/auditoria')))?.texto).toBe(`${cab()}\n\n_Nenhum lançamento no período._`)
    expect(auditor.sugerir).not.toHaveBeenCalled()
  })

  it('sem auditor configurado: título e o aviso de IA desligada', async () => {
    const s = await comDados(novo())
    expect((await s.handle(msg('/auditoria')))?.texto).toBe(`${cab()}\n\n${IA_DESLIGADA}`)
  })

  it('auditor falha: relatório calculado sai com "Indisponível" e o erro só vai para o log', async () => {
    const s = await comDados(novo(auditorFalso(new Error('OpenRouter (x) respondeu 500'))))
    expect((await s.handle(msg('/auditoria')))?.texto).toBe(indisponivel)
    expect(console.error).toHaveBeenCalled()
  })

  it('auditor devolve lista vazia: também "Indisponível"', async () => {
    const s = await comDados(novo(auditorFalso([])))
    expect((await s.handle(msg('/auditoria')))?.texto).toBe(indisponivel)
  })

  it('auditoria semanal (domingo a sábado) compara com a semana anterior', async () => {
    const auditor = auditorFalso()
    const s = novo(auditor)
    await s.handle(msg('/r plantão 100', '2026-09-14T12:00:00Z'))
    await s.handle(msg('/d mercado 30', '2026-09-15T12:00:00Z'))
    await s.handle(msg('/d mercado 50', '2026-09-08T12:00:00Z'))
    expect((await s.handle(msg('/auditoria semanal')))?.texto).toBe(
      secoes(
        cab('Semanal · 13/09 a 19/09'),
        resumo('R$ 100,00', 'R$ 30,00', 'R$ 70,00'),
        gastos('🥇 mercado\n*R$ 30,00* · _100%_'),
        comparacao('06/09 a 12/09', '_R$ 0,00 →_ *R$ 100,00*', '_R$ 50,00 →_ *R$ 30,00*', '_-R$ 50,00 →_ *R$ 70,00*', '\n_▼ 40%_'),
        ia('• _Reduza os gastos com mercado_', '• _Monte uma reserva_'),
      ),
    )
    expect(auditor.sugerir.mock.calls[0][0].periodo).toBe('13/09 a 19/09')
  })

  it('auditoria anual compara com o ano anterior', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('/d mercado 200', '2026-03-10T12:00:00Z'))
    await s.handle(msg('/d mercado 100', '2025-05-10T12:00:00Z'))
    const t = (await s.handle(msg('/auditoria anual')))?.texto
    expect(t).toContain('_Anual · 2026_')
    expect(t).toContain('_Período anterior: 2025_')
    expect(t).toContain('_R$ 100,00 →_ *R$ 200,00*\n_▲ 100%_')
  })

  it('só receitas no período: sem ranking de gastos', async () => {
    const s = novo(auditorFalso())
    await s.handle(msg('/r salário 100', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('/auditoria')))?.texto
    expect(t).not.toContain('🏆')
    expect(t).toContain('🟢 Receitas\n*R$ 100,00*')
  })

  it('descrições e texto da IA com * _ ~ ` não quebram a formatação; o banco guarda o original', async () => {
    const repo = new MemoryRepo()
    const s = new Service(repo, contasEmMemoria(), agora, auditorFalso(['Corte *tudo* _já_ ~agora~ `ok`']))
    await s.handle(msg('/d mercado_*teste* 10', '2026-09-10T12:00:00Z'))
    const t = (await s.handle(msg('/auditoria')))!.texto
    expect(t).toContain('🥇 mercado＿∗teste∗')
    expect(t).toContain('• _Corte ∗tudo∗ ＿já＿ ∼agora∼ ˋokˋ_')
    expect((await repo.extrato({ de: new Date(0), ate: new Date('2100-01-01') }))[0].conta).toBe('mercado_*teste*')
  })

  it('uso incorreto responde a dica', async () => {
    expect((await novo().handle(msg('/auditoria trimestre')))?.texto).toBe(USO_AUDITORIA)
  })

  it('mensagem recuperada não gera auditoria nem dica de uso', async () => {
    const auditor = auditorFalso()
    const s = await comDados(novo(auditor))
    expect(await s.handle(msg('/auditoria'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/auditoria semanal'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/auditoria 500'), { recuperada: true })).toBeNull()
    expect(auditor.sugerir).not.toHaveBeenCalled()
  })
})

describe('Service: extrato', () => {
  it('golden: todos os lançamentos, do mais recente ao mais antigo, com totais gerais', async () => {
    const s = novoService()
    await s.handle(msg('/r salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('/d mercado 345,90', '2026-09-10T15:30:00Z'))
    await s.handle(msg('/d luz 166,50', '2026-09-12T18:05:00Z'))
    await s.handle(msg('/r plantão 450 01/09', '2026-09-13T12:00:00Z'))
    const r = await s.handle(msg('/extrato'))
    expect(r).toEqual({
      texto: secoes(
        '📒 *EXTRATO*\n_Página 1 de 1_',
        tot('R$ 3.450,00', 'R$ 512,40', 'R$ 2.937,60'),
        [
          '📅 *12/09 · 15:05*\n🔴 _luz_\n*− R$ 166,50*',
          '📅 *10/09 · 12:30*\n🔴 _mercado_\n*− R$ 345,90*',
          '📅 *05/09 · 09:00*\n🟢 _salário_\n*+ R$ 3.000,00*',
          '📅 *01/09 · 09:00*\n🟢 _plantão_\n*+ R$ 450,00*',
        ].join('\n\n'),
      ),
      lancou: false,
    })
    expect((await s.handle(msg('/EXTRATO 1 ')))?.texto).toBe(r?.texto)
  })

  it('empate de data: enviadoEm mais recente primeiro; empatando também, o inserido por último primeiro', async () => {
    const s = novoService()
    await s.handle(msg('/d a 1', '2026-09-10T12:00:00Z'))
    await s.handle(msg('/d b 2', '2026-09-10T15:00:00Z'))
    await s.handle(msg('/d c 3', '2026-09-10T15:00:00Z'))
    const t = (await s.handle(msg('/extrato')))!.texto
    expect(t.indexOf('_c_')).toBeLessThan(t.indexOf('_b_'))
    expect(t.indexOf('_b_')).toBeLessThan(t.indexOf('_a_'))
  })

  it('vazio, em qualquer página', async () => {
    const s = novoService()
    expect((await s.handle(msg('/extrato')))?.texto).toBe('📒 *EXTRATO*\n\n_Nenhum lançamento encontrado._')
    expect((await s.handle(msg('/extrato 3')))?.texto).toBe('📒 *EXTRATO*\n\n_Nenhum lançamento encontrado._')
  })

  it('desfeito não aparece e não entra nos totais', async () => {
    const s = novoService()
    await s.handle(msg('/d mercado 10', '2026-09-10T12:00:00Z'))
    await s.handle(msg('/d luz 20', '2026-09-11T12:00:00Z'))
    await s.handle(msg('/desfazer', '2026-09-11T13:00:00Z'))
    const t = (await s.handle(msg('/extrato')))!.texto
    expect(t).not.toContain('luz')
    expect(t).toContain('🔴 Despesas\n*R$ 10,00*')
  })

  describe('paginado', () => {
    // 45 lançamentos item0..item44 (valor i+1), um por dia; totais gerais = soma de 1..45 = 1035
    const montar = async () => {
      const s = novoService()
      for (let i = 0; i < 45; i++) {
        const dia = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString()
        await s.handle(msg(`/d item${i} ${i + 1}`, dia))
      }
      return s
    }
    const itens = (texto: string) => [...texto.matchAll(/^🔴 _(item\d+)_$/gm)].map((m) => m[1])

    it('3 páginas: 20 + 20 + 5, totais só na 1, rodapé certo, tudo uma vez e em ordem decrescente', async () => {
      expect(POR_PAGINA).toBe(20)
      const s = await montar()
      const p1 = (await s.handle(msg('/extrato')))!.texto
      const p2 = (await s.handle(msg('/extrato 2')))!.texto
      const p3 = (await s.handle(msg('/extrato 3')))!.texto

      expect(p1.startsWith(`📒 *EXTRATO*\n_Página 1 de 3_\n\n${SEP}\n\n${tot('R$ 0,00', 'R$ 1.035,00', '-R$ 1.035,00', '⚠️')}\n\n${SEP}\n\n📅 *`)).toBe(true)
      expect(p1.endsWith(`\n\n${SEP}\n\n➡️ _Digite */extrato 2* para continuar._`)).toBe(true)
      expect(p2.startsWith(`📒 *EXTRATO*\n_Página 2 de 3_\n\n${SEP}\n\n📅 *`)).toBe(true)
      expect(p2).not.toContain('Receitas')
      expect(p2.endsWith(`\n\n${SEP}\n\n➡️ _Digite */extrato 3* para continuar._`)).toBe(true)
      expect(p3.startsWith(`📒 *EXTRATO*\n_Página 3 de 3_\n\n${SEP}\n\n📅 *`)).toBe(true)
      expect(p3).not.toContain('Despesas')
      expect(p3.endsWith(`\n\n${SEP}\n\n✅ _Fim do extrato._`)).toBe(true)

      expect([itens(p1).length, itens(p2).length, itens(p3).length]).toEqual([20, 20, 5])
      const todos = [...itens(p1), ...itens(p2), ...itens(p3)]
      expect(todos).toEqual(Array.from({ length: 45 }, (_, i) => `item${44 - i}`))
    })

    it('página além do fim', async () => {
      const s = await montar()
      expect((await s.handle(msg('/extrato 4')))?.texto).toBe('📒 *PÁGINA INEXISTENTE*\n\n_O extrato tem só 3 páginas._\n\n➡️ _Digite */extrato* para começar._')
      const um = novoService()
      await um.handle(msg('/d mercado 10'))
      expect((await um.handle(msg('/extrato 2')))?.texto).toBe('📒 *PÁGINA INEXISTENTE*\n\n_O extrato tem só 1 página._\n\n➡️ _Digite */extrato* para começar._')
    })

    it('exatamente 20 lançamentos é uma página só, sem rodapé', async () => {
      const s = novoService()
      for (let i = 0; i < 20; i++) await s.handle(msg(`/d item${i} 1`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()))
      const t = (await s.handle(msg('/extrato')))!.texto
      expect(t).toContain('_Página 1 de 1_')
      expect(t).not.toContain('➡️')
      expect(t).not.toContain('✅')
    })
  })

  it.each([['extrato 0'], ['extrato abc'], ['extrato -1'], ['extrato 2 3']])('uso incorreto: %s', async (texto) => {
    expect(await novoService().handle(msg(`/${texto}`))).toEqual({ texto: USO_EXTRATO, lancou: false })
  })

  it('mensagem recuperada não gera extrato nem dica de uso', async () => {
    const s = novoService()
    expect(await s.handle(msg('/extrato'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/extrato 2'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/extrato abc'), { recuperada: true })).toBeNull()
  })
})

describe('Service: ajuda e recuperação', () => {
  it('ajuda é um menu com todos os comandos', async () => {
    const t = (await novoService().handle(msg('/ajuda')))!.texto
    expect(t.startsWith('🤖 *WCOEN*\n_Seu controle financeiro pelo WhatsApp_')).toBe(true)
    for (const c of ['/d mercado 45,90', '/r plantão 70', '/d mercado 45 ontem', '/balancete', '/balancete mensal', '/balancete semanal', '/balancete anual', '/auditoria mensal', '/auditoria semanal', '/auditoria anual', '/extrato', '/extrato 2', '/desfazer']) {
      expect(t).toContain(`\`${c}\``)
    }
    for (const t2 of ['LANÇAMENTOS', 'RELATÓRIOS', 'AUDITORIA', 'EXTRATO', 'CORREÇÃO']) expect(t).toContain(`*${t2}*`)
    expect(t).not.toContain('trimestre')
    expect(t).not.toMatch(/\*\*|^#/m) // nada de Markdown de GitHub
  })

  it('mensagem recuperada grava lançamento com a data original, mas não responde balancete, uso incorreto nem ajuda', async () => {
    const s = novoService()
    expect(await s.handle(msg('/balancete'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/balancete semanal'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/balancete mercado'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('/ajuda'), { recuperada: true })).toBeNull()
    const r = await s.handle(msg('/d mercado 10', '2026-08-31T12:00:00Z'), { recuperada: true })
    expect(r?.lancou).toBe(true)
    expect((await s.handle(msg('/balancete mensal')))?.texto).toContain('📅 *Agosto/2026*')
  })
})

describe('Service: falhas', () => {
  const quebrado: Repo = {
    add: vi.fn().mockRejectedValue(new Error('mongo fora')),
    desfazerUltimo: vi.fn().mockRejectedValue(new Error('mongo fora')),
    balancete: vi.fn().mockRejectedValue(new Error('mongo fora')),
    extrato: vi.fn().mockRejectedValue(new Error('mongo fora')),
    serieMensal: vi.fn().mockRejectedValue(new Error('mongo fora')),
  }

  it('não confirma com ✅ quando a gravação falha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = new Service(quebrado, contasEmMemoria(), agora)
    expect(await s.handle(msg('/d mercado 10'))).toEqual({ texto: ERRO_SALVAR, lancou: false })
    expect((await s.handle(msg('/desfazer')))?.texto).toBe(ERRO_SALVAR)
    expect((await s.handle(msg('/balancete')))?.texto).toBe(ERRO_GENERICO)
  })

  it('mensagem que falhou pode ser tentada de novo com o mesmo msgId', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const add = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('ok')
    const s = new Service({ ...quebrado, add }, contasEmMemoria(), agora)
    expect((await s.handle(msg('/d mercado 10', undefined, 'r1')))?.texto).toBe(ERRO_SALVAR)
    expect((await s.handle(msg('/d mercado 10', undefined, 'r1')))?.lancou).toBe(true)
  })
})

const NUBANK: ContaCorrenteComSaldo = { id: 'cc2', apelido: 'nubank', nome: 'Nubank', saldoInicial: 0, saldo: 150000, favorita: false, ativa: true }
const ANTIGA: ContaCorrenteComSaldo = { id: 'cc3', apelido: 'antiga', nome: 'Antiga', saldoInicial: 0, saldo: 0, favorita: false, ativa: false }
const comDuasContas = (repo = new MemoryRepo()) => new Service(repo, contasEmMemoria([PRINCIPAL, NUBANK, ANTIGA]), agora)
const mes = { de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') }

describe('Service: contas correntes', () => {
  it('sem @ vai para a favorita; com @ vai para a outra', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    await s.handle(msg('/d mercado 10'))
    await s.handle(msg('/d farmácia 20 @nubank'))
    const itens = await repo.extrato(mes)
    expect(itens.map((l) => [l.conta, l.contaCorrenteId])).toEqual([['mercado', 'cc1'], ['farmácia', 'cc2']])
  })

  it('a confirmação mostra o nome da conta só com 2+ contas ativas', async () => {
    const r2 = await comDuasContas().handle(msg('/d farmácia 20 @nubank'))
    expect(r2?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _farmácia_\n💰 *R$ 20,00*\n🏦 _Nubank_')
    const r1 = await novoService().handle(msg('/d mercado 45,90'))
    expect(r1?.texto).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _mercado_\n💰 *R$ 45,90*')
  })

  it('@ desconhecido ou desativada: não grava e lista as contas ativas', async () => {
    const repo = new MemoryRepo()
    const s = comDuasContas(repo)
    for (const texto of ['/d mercado 10 @nada', '/d mercado 10 @antiga']) {
      const r = await s.handle(msg(texto))
      expect(r?.lancou).toBe(false)
      expect(r?.texto).toContain('CONTA NÃO ENCONTRADA')
      expect(r?.texto).toContain('Nenhum lançamento foi registrado')
      expect(r?.texto).toContain('@principal')
      expect(r?.texto).toContain('@nubank')
      expect(r?.texto).not.toContain('@antiga ·')
    }
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('descrição com @ no meio vira conta: se não existir, nada é gravado', async () => {
    const repo = new MemoryRepo()
    const r = await comDuasContas(repo).handle(msg('/d pix @joao 50'))
    expect(r?.lancou).toBe(false)
    expect(await repo.extrato(mes)).toEqual([])
  })

  it('/desfazer diz de qual conta saiu o lançamento quando há 2+ contas ativas; com uma só, fica como antes', async () => {
    const s = comDuasContas()
    await s.handle(msg('/d farmácia 20 @nubank'))
    expect((await s.handle(msg('/desfazer')))?.texto).toBe('↩️ *LANÇAMENTO DESFEITO*\n\n📝 _farmácia_\n💰 *R$ 20,00*\n🏦 _Nubank_')
    const um = novoService()
    await um.handle(msg('/d mercado 45,90'))
    expect((await um.handle(msg('/desfazer')))?.texto).toBe('↩️ *LANÇAMENTO DESFEITO*\n\n📝 _mercado_\n💰 *R$ 45,90*')
  })

  it('/contas lista as ativas com saldo e marca a favorita', async () => {
    const r = await comDuasContas().handle(msg('/contas'))
    expect(r).toEqual({
      lancou: false,
      texto: secoes('🏦 *CONTAS CORRENTES*', '⭐ *Principal*\n`@principal`\n💰 *R$ 0,00*', '*Nubank*\n`@nubank`\n💰 *R$ 1.500,00*'),
    })
  })

  it('/b e /e com @ filtram pela conta e dizem qual; sem @ somam todas', async () => {
    const s = comDuasContas()
    const hoje = '2026-09-15T12:00:00Z' // o `agora` do Service: o /b do dia só mostra lançamentos de hoje
    await s.handle(msg('/d mercado 10', hoje))
    await s.handle(msg('/d farmácia 20 @nubank', hoje))
    const nu = (await s.handle(msg('/b @nubank')))?.texto ?? ''
    expect(nu).toContain('farmácia')
    expect(nu).not.toContain('mercado')
    expect(nu).toContain('Nubank')
    const ex = (await s.handle(msg('/e @nubank')))?.texto ?? ''
    expect(ex).toContain('farmácia')
    expect(ex).not.toContain('mercado')
    const todos = (await s.handle(msg('/b')))?.texto ?? ''
    expect(todos).toContain('farmácia')
    expect(todos).toContain('mercado')
    expect((await s.handle(msg('/b mensal @nubank')))?.texto).toContain('R$ 20,00')
  })

  it('filtro por @ inexistente responde conta não encontrada; desativada ainda filtra', async () => {
    const s = comDuasContas()
    expect((await s.handle(msg('/b @nada')))?.texto).toContain('CONTA NÃO ENCONTRADA')
    expect((await s.handle(msg('/b @nada')))?.texto).not.toContain('Nenhum lançamento foi registrado')
    expect((await s.handle(msg('/e @antiga')))?.texto).toContain('Nenhum lançamento')
    expect((await s.handle(msg('/e @antiga')))?.texto).not.toContain('CONTA NÃO ENCONTRADA')
  })

  it('/contas e filtros não rodam em mensagens recuperadas', async () => {
    expect(await comDuasContas().handle(msg('/contas'), { recuperada: true })).toBeNull()
  })

  it('/ajuda cita @conta e /contas', async () => {
    const t = (await novoService().handle(msg('/ajuda')))?.texto ?? ''
    expect(t).toContain('@conta')
    expect(t).toContain('/contas')
  })
})

describe('Service: transferências fora da auditoria', () => {
  it('só com transferências no período, a auditoria diz que não há lançamentos e não chama a IA', async () => {
    const repo = new MemoryRepo()
    await repo.add({ tipo: 'transferencia', conta: 'transferência', valor: 500, remetente: 'u', msgId: 't1', data: new Date('2026-09-10T12:00:00Z'), enviadoEm: new Date('2026-09-10T12:00:00Z'), contaCorrenteId: 'cc1', contaDestinoId: 'cc2' })
    const auditor: Auditor = { sugerir: vi.fn(async () => ['dica']) }
    const r = await new Service(repo, contasEmMemoria(), agora, auditor).handle(msg('/auditoria'))
    expect(r?.texto).toContain('Nenhum lançamento no período')
    expect(auditor.sugerir).not.toHaveBeenCalled()
  })
})
