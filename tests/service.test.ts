import { describe, it, expect, vi } from 'vitest'
import { Service, ERRO_SALVAR, ERRO_GENERICO, ERRO_DATA, IA_DESLIGADA, type Mensagem } from '../src/service'
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
    expect(r).toEqual({ texto: '✅ Despesa: mercado R$ 45,90', lancou: true })
  })

  it('registra receita e confirma', async () => {
    const r = await novoService().handle(msg('+ salário 3000'))
    expect(r).toEqual({ texto: '✅ Receita: salário R$ 3.000,00', lancou: true })
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
    expect((await s.handle(msg('desfazer')))?.texto).toBe('↩️ Desfeito: mercado R$ 45,90')
    expect((await s.handle(msg('desfazer')))?.texto).toBe('Nada para desfazer.')
  })

  it('desfazer reentregue (mesmo msgId) desfaz só uma vez', async () => {
    // Review Focus 3
    const s = novoService()
    await s.handle(msg('mercado 10'))
    await s.handle(msg('luz 20'))
    expect((await s.handle(msg('desfazer', undefined, 'd1')))?.texto).toBe('↩️ Desfeito: luz R$ 20,00')
    expect(await s.handle(msg('desfazer', undefined, 'd1'))).toBeNull()
    expect((await s.handle(msg('desfazer')))?.texto).toBe('↩️ Desfeito: mercado R$ 10,00')
  })
})

describe('Service: balancete', () => {
  async function comDados() {
    const s = novoService()
    await s.handle(msg('+ salário 3000', '2026-09-05T12:00:00Z'))
    await s.handle(msg('mercado 345,90', '2026-09-10T12:00:00Z'))
    await s.handle(msg('luz 166,50', '2026-09-12T12:00:00Z'))
    await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z')) // fora de setembro
    return s
  }

  it('mês atual', async () => {
    const r = await (await comDados()).handle(msg('balancete'))
    expect(r?.texto).toBe(
      [
        '📊 Balancete 09/2026',
        'Receitas: R$ 3.000,00',
        '  salário  3.000,00',
        'Despesas: R$ 512,40',
        '  mercado  345,90',
        '  luz      166,50',
        'Saldo: R$ 2.487,60',
      ].join('\n'),
    )
    expect(r?.lancou).toBe(false)
  })

  it('mês específico e tudo', async () => {
    const s = await comDados()
    expect((await s.handle(msg('balancete 08/2026')))?.texto).toContain('Despesas: R$ 10,00')
    expect((await s.handle(msg('balancete tudo')))?.texto).toContain('Despesas: R$ 522,40')
  })

  it('período vazio', async () => {
    const r = await novoService().handle(msg('balancete'))
    expect(r?.texto).toBe('📊 Balancete 09/2026\nSem lançamentos no período.')
  })
})

describe('Service: balancete por semana (segunda a domingo)', () => {
  async function comDados() {
    const s = novoService() // agora = terça 15/09/2026
    await s.handle(msg('mercado 10', '2026-09-14T12:00:00Z')) // segunda: semana atual
    await s.handle(msg('luz 20', '2026-09-13T12:00:00Z')) // domingo: semana passada
    return s
  }

  it('semana atual', async () => {
    const r = await (await comDados()).handle(msg('balancete semana'))
    expect(r?.texto).toBe(
      [
        '📊 Balancete semana 14/09 a 20/09',
        'Receitas: R$ 0,00',
        'Despesas: R$ 10,00',
        '  mercado  10,00',
        'Saldo: -R$ 10,00',
      ].join('\n'),
    )
  })

  it('semana passada', async () => {
    const r = await (await comDados()).handle(msg('balancete semana passada'))
    expect(r?.texto).toBe(
      [
        '📊 Balancete semana 07/09 a 13/09',
        'Receitas: R$ 0,00',
        'Despesas: R$ 20,00',
        '  luz  20,00',
        'Saldo: -R$ 20,00',
      ].join('\n'),
    )
  })
})

describe('Service: trimestre e ano', () => {
  async function comDados() {
    const s = novoService() // agora = 15/09/2026 → trimestre = jun, jul e ago
    await s.handle(msg('mercado 10', '2026-06-15T12:00:00Z')) // dentro do trimestre
    await s.handle(msg('luz 20', '2026-09-05T12:00:00Z')) // mês atual: fora do trimestre
    await s.handle(msg('gas 30', '2026-05-31T12:00:00Z')) // antes do trimestre
    await s.handle(msg('agua 5', '2025-12-31T12:00:00Z')) // ano passado
    return s
  }

  it('trimestre = 3 meses fechados antes do mês atual', async () => {
    const r = await (await comDados()).handle(msg('balancete trimestre'))
    expect(r?.texto).toBe(
      [
        '📊 Balancete trimestre 06/2026 a 08/2026',
        'Receitas: R$ 0,00',
        'Despesas: R$ 10,00',
        '  mercado  10,00',
        'Saldo: -R$ 10,00',
      ].join('\n'),
    )
  })

  it('ano do calendário atual e ano específico', async () => {
    const s = await comDados()
    const atual = await s.handle(msg('balancete ano'))
    expect(atual?.texto).toContain('📊 Balancete 2026\n')
    expect(atual?.texto).toContain('Despesas: R$ 60,00') // 10 + 20 + 30, sem os 5 de 2025
    const passado = await s.handle(msg('balancete 2025'))
    expect(passado?.texto).toContain('📊 Balancete 2025\n')
    expect(passado?.texto).toContain('Despesas: R$ 5,00')
  })
})

describe('Service: filtros do balancete', () => {
  async function comDados() {
    const s = novoService()
    await s.handle(msg('+ plantão 450'))
    await s.handle(msg('mercado 100'))
    await s.handle(msg('luz 50'))
    await s.handle(msg('mercado 20'))
    return s
  }

  it('só despesas', async () => {
    const r = await (await comDados()).handle(msg('balancete despesas'))
    expect(r?.texto).toBe(
      [
        '📊 Balancete 09/2026 · despesas',
        'Despesas: R$ 170,00',
        '  mercado  120,00',
        '  luz      50,00',
      ].join('\n'),
    )
  })

  it('só receitas', async () => {
    const r = await (await comDados()).handle(msg('balancete receitas'))
    expect(r?.texto).toBe(['📊 Balancete 09/2026 · receitas', 'Receitas: R$ 450,00', '  plantão  450,00'].join('\n'))
  })

  it('quanto gastei só em mercado', async () => {
    const r = await (await comDados()).handle(msg('balancete mercado'))
    expect(r?.texto).toBe(['📊 Balancete 09/2026 · mercado', 'Despesas: R$ 120,00'].join('\n'))
  })

  it('conta com receita e despesa mostra os dois e o saldo', async () => {
    const s = await comDados()
    await s.handle(msg('+ mercado 30')) // reembolso
    const r = await s.handle(msg('balancete mercado'))
    expect(r?.texto).toBe(
      ['📊 Balancete 09/2026 · mercado', 'Receitas: R$ 30,00', 'Despesas: R$ 120,00', 'Saldo: -R$ 90,00'].join('\n'),
    )
  })

  it('período e filtro juntos', async () => {
    const s = await comDados()
    expect((await s.handle(msg('balancete tudo mercado')))?.texto).toContain('📊 Balancete tudo · mercado')
    expect((await s.handle(msg('balancete semana despesas')))?.texto).toContain('📊 Balancete semana 14/09 a 20/09 · despesas')
  })

  it('conta inexistente', async () => {
    const r = await (await comDados()).handle(msg('balancete inexistente'))
    expect(r?.texto).toBe('📊 Balancete 09/2026 · inexistente\nSem lançamentos no período.')
  })
})

describe('Service: data do lançamento', () => {
  it('sem data informada, vale a data de envio da mensagem', async () => {
    const s = novoService()
    // enviada em 31/08 (antes do "agora" de setembro): cai em agosto, e a confirmação não mostra data
    const r = await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z'))
    expect(r?.texto).toBe('✅ Despesa: mercado R$ 10,00')
    expect((await s.handle(msg('balancete 08/2026')))?.texto).toContain('Despesas: R$ 10,00')
    expect((await s.handle(msg('balancete 09/2026')))?.texto).toBe('📊 Balancete 09/2026\nSem lançamentos no período.')
  })

  it('com data informada, lança nela e mostra o dia na confirmação', async () => {
    const s = novoService() // mensagens enviadas em 10/09/2026
    expect((await s.handle(msg('+ plantão 450 ontem')))?.texto).toBe('✅ Receita: plantão R$ 450,00 (09/09)')
    expect((await s.handle(msg('mercado 10 31/08')))?.texto).toBe('✅ Despesa: mercado R$ 10,00 (31/08)')
    expect((await s.handle(msg('balancete 08/2026')))?.texto).toContain('Despesas: R$ 10,00')
    expect((await s.handle(msg('balancete 09/2026')))?.texto).toContain('Receitas: R$ 450,00')
  })

  it('sem ano e no futuro assume o ano anterior', async () => {
    const r = await novoService().handle(msg('mercado 10 25/09'))
    expect(r?.texto).toBe('✅ Despesa: mercado R$ 10,00 (25/09)')
  })

  it('recusa data no futuro ou inexistente, sem lançar', async () => {
    // Review Focus 5
    const s = novoService()
    expect(await s.handle(msg('mercado 10 25/09/2026'))).toEqual({ texto: ERRO_DATA, lancou: false })
    expect((await s.handle(msg('mercado 10 29/02/2026')))?.texto).toBe(ERRO_DATA)
    expect((await s.handle(msg('balancete tudo')))?.texto).toBe('📊 Balancete tudo\nSem lançamentos no período.')
  })

  it('desfazer desfaz o último enviado, não o de data mais recente', async () => {
    // Review Focus 5
    const s = novoService()
    await s.handle(msg('mercado 10', '2026-09-10T11:00:00Z'))
    await s.handle(msg('+ plantão 450 01/09', '2026-09-10T12:00:00Z'))
    expect((await s.handle(msg('desfazer', '2026-09-10T13:00:00Z')))?.texto).toBe('↩️ Desfeito: plantão R$ 450,00')
  })
})

describe('Service: ajuda e recuperação', () => {
  it('ajuda lista os comandos', async () => {
    const r = await novoService().handle(msg('ajuda'))
    expect(r?.texto).toContain('balancete')
    expect(r?.texto).toContain('desfazer')
  })

  it('mensagem recuperada grava lançamento com a data original, mas não responde balancete/ajuda', async () => {
    const s = novoService()
    expect(await s.handle(msg('balancete'), { recuperada: true })).toBeNull()
    expect(await s.handle(msg('ajuda'), { recuperada: true })).toBeNull()
    const r = await s.handle(msg('mercado 10', '2026-08-31T12:00:00Z'), { recuperada: true })
    expect(r?.lancou).toBe(true)
    expect((await s.handle(msg('balancete 08/2026')))?.texto).toContain('Despesas: R$ 10,00')
  })
})

describe('Service: agrupamento por IA (só sob pedido)', () => {
  const agrupadorFalso = (r: string[] | Error) => ({
    agrupar: vi.fn(async (_termo: string, _contas: string[]) => {
      if (r instanceof Error) throw r
      return r
    }),
  })

  async function servicoComDados(agrupador?: ReturnType<typeof agrupadorFalso>) {
    const s = new Service(new MemoryRepo(), agora, agrupador)
    await s.handle(msg('gasolina 300'))
    await s.handle(msg('óleo 120'))
    await s.handle(msg('mercado 200'))
    await s.handle(msg('+ plantão 450'))
    return s
  }

  it('"ia carro": a IA escolhe as contas relacionadas e o bot soma', async () => {
    const agr = agrupadorFalso(['gasolina', 'óleo'])
    const r = await (await servicoComDados(agr)).handle(msg('balancete ia carro'))
    expect(agr.agrupar).toHaveBeenCalledWith('carro', ['gasolina', 'mercado', 'plantão', 'óleo'])
    expect(r?.texto).toBe(
      [
        '📊 Balancete 09/2026 · carro (agrupado por IA)',
        'Despesas: R$ 420,00',
        '  gasolina  300,00',
        '  óleo      120,00',
      ].join('\n'),
    )
  })

  it('receitas e despesas escolhidas mostram os dois blocos e o saldo', async () => {
    const r = await (await servicoComDados(agrupadorFalso(['mercado', 'plantão']))).handle(msg('balancete ia lazer'))
    expect(r?.texto).toBe(
      [
        '📊 Balancete 09/2026 · lazer (agrupado por IA)',
        'Receitas: R$ 450,00',
        '  plantão  450,00',
        'Despesas: R$ 200,00',
        '  mercado  200,00',
        'Saldo: R$ 250,00',
      ].join('\n'),
    )
  })

  it('combina com período', async () => {
    const r = await (await servicoComDados(agrupadorFalso(['gasolina']))).handle(msg('balancete ano ia carro'))
    expect(r?.texto).toContain('📊 Balancete 2026 · carro (agrupado por IA)')
  })

  it('conta comum nunca chama a IA, exista ou não', async () => {
    // Review Focus 6
    const agr = agrupadorFalso(['gasolina'])
    const s = await servicoComDados(agr)
    expect((await s.handle(msg('balancete mercado')))?.texto).toBe('📊 Balancete 09/2026 · mercado\nDespesas: R$ 200,00')
    expect((await s.handle(msg('balancete carro')))?.texto).toBe('📊 Balancete 09/2026 · carro\nSem lançamentos no período.')
    expect(agr.agrupar).not.toHaveBeenCalled()
  })

  it('período sem nenhuma conta: não chama a IA', async () => {
    const agr = agrupadorFalso(['gasolina'])
    const s = new Service(new MemoryRepo(), agora, agr)
    expect((await s.handle(msg('balancete ia carro')))?.texto).toBe('📊 Balancete 09/2026 · carro\nSem lançamentos no período.')
    expect(agr.agrupar).not.toHaveBeenCalled()
  })

  it('IA sem contas relacionadas', async () => {
    const r = await (await servicoComDados(agrupadorFalso([]))).handle(msg('balancete ia carro'))
    expect(r?.texto).toBe('📊 Balancete 09/2026 · carro\nNão achei contas relacionadas a "carro" no período.')
  })

  it('IA falha: avisa e não lança exceção', async () => {
    // Review Focus 6
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await (await servicoComDados(agrupadorFalso(new Error('timeout')))).handle(msg('balancete ia carro'))
    expect(r?.texto).toBe('📊 Balancete 09/2026 · carro\nNão consegui agrupar agora, tente de novo.')
  })

  it('sem agrupador configurado: "ia carro" avisa que a IA está desligada', async () => {
    const r = await (await servicoComDados()).handle(msg('balancete ia carro'))
    expect(r?.texto).toBe(`📊 Balancete 09/2026 · carro\n${IA_DESLIGADA}`)
  })
})

describe('Service: falhas', () => {
  const quebrado: Repo = {
    add: vi.fn().mockRejectedValue(new Error('mongo fora')),
    desfazerUltimo: vi.fn().mockRejectedValue(new Error('mongo fora')),
    balancete: vi.fn().mockRejectedValue(new Error('mongo fora')),
    contas: vi.fn().mockRejectedValue(new Error('mongo fora')),
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
