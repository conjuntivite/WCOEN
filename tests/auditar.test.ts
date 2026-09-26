import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { criarAuditorOpenRouter, limparSugestoes, type DadosAuditoria } from '../src/auditar'

describe('limparSugestoes', () => {
  it('uma sugestão por linha, sem marcadores nem linhas vazias', () => {
    const texto = '• Reduza o mercado\n\n- Monte uma reserva\n* Corte a luz\n1. Passo um\n  2) Passo dois  '
    expect(limparSugestoes(texto)).toEqual(['Reduza o mercado', 'Monte uma reserva', 'Corte a luz', 'Passo um', 'Passo dois'])
  })

  it('mantém no máximo 5', () => {
    expect(limparSugestoes('• a\n• b\n• c\n• d\n• e\n• f\n• g')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('corta em 200 caracteres com reticências', () => {
    const [s] = limparSugestoes('• ' + 'x'.repeat(300))!
    expect(s).toBe('x'.repeat(199) + '…')
    expect(s).toHaveLength(200)
  })

  it('200 caracteres exatos não são cortados', () => {
    expect(limparSugestoes('• ' + 'x'.repeat(200))).toEqual(['x'.repeat(200)])
  })

  it.each([[''], ['   \n \n'], ['•'], ['- \n* ']])('nada aproveitável (%j) devolve null', (texto) => {
    expect(limparSugestoes(texto)).toBeNull()
  })
})

describe('criarAuditorOpenRouter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const dados: DadosAuditoria = {
    periodo: '09/2026',
    receitas: 'R$ 3.000,00',
    despesas: 'R$ 512,40',
    saldo: 'R$ 2.487,60',
    rankingDespesas: [{ conta: 'mercado', valor: 'R$ 345,90', percentual: 68 }],
    receitasPorConta: [{ conta: 'salário', valor: 'R$ 3.000,00' }],
    lancamentos: [{ data: '10/09/2026', tipo: 'despesa', conta: 'mercado', valor: 'R$ 345,90' }],
  }

  const resposta = (conteudo: string, status = 200) =>
    new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status })

  // devolve as respostas em sequência, uma por chamada de fetch; um Error vira falha de rede
  const sequencia = (...itens: Array<Response | Error>) =>
    vi.fn(async () => {
      const item = itens.shift()
      if (!item) throw new Error('fetch chamado a mais')
      if (item instanceof Error) throw item
      return item
    })

  const criar = (models: string[], fetchFn: ReturnType<typeof sequencia>) =>
    criarAuditorOpenRouter({ apiKey: 'chave-secreta', models, fetchFn: fetchFn as unknown as typeof fetch })

  const chamada = (fetchFn: ReturnType<typeof sequencia>, n: number) => {
    const [url, init] = fetchFn.mock.calls[n] as unknown as [string, RequestInit]
    return { url, init, corpo: JSON.parse(init.body as string) }
  }

  it('chama o OpenRouter: chave só no header, corpo com os dados e o prompt, sem a chave', async () => {
    const fetchFn = sequencia(resposta('• Reduza o mercado\n• Monte uma reserva'))

    expect(await criar(['pago/x'], fetchFn).sugerir(dados)).toEqual(['Reduza o mercado', 'Monte uma reserva'])

    const { url, init, corpo } = chamada(fetchFn, 0)
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer chave-secreta')
    expect(init.body).not.toContain('chave-secreta')
    expect(corpo.model).toBe('pago/x')
    expect(corpo.temperature).toBe(0.3)
    expect(corpo.messages[0].role).toBe('system')
    expect(corpo.messages[0].content).toMatch(/^Você é um consultor de finanças pessoais\./)
    expect(corpo.messages[0].content).toContain('nunca invente ou recalcule valores')
    expect(corpo.messages[1]).toEqual({ role: 'user', content: JSON.stringify(dados) })
  })

  it('modelo pago falha (HTTP, rede, sem conteúdo ou fora do combinado): usa o próximo, em ordem', async () => {
    const fetchFn = sequencia(
      resposta('', 500),
      new Error('rede caiu'),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      resposta('   \n'),
      resposta('• Deu certo'),
    )
    expect(await criar(['a', 'b', 'c', 'd', 'e'], fetchFn).sugerir(dados)).toEqual(['Deu certo'])
    expect(fetchFn).toHaveBeenCalledTimes(5)
    expect([0, 1, 2, 3, 4].map((i) => chamada(fetchFn, i).corpo.model)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('todos os modelos falham: lança o último erro', async () => {
    const fetchFn = sequencia(resposta('', 500), resposta('', 429))
    await expect(criar(['a', 'b'], fetchFn).sugerir(dados)).rejects.toThrow('OpenRouter (b) respondeu 429')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('sem modelos configurados: falha sem chamar a rede', async () => {
    const fetchFn = sequencia()
    await expect(criar([], fetchFn).sugerir(dados)).rejects.toThrow('nenhum modelo configurado para a IA')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('cada tentativa tem timeout (signal)', async () => {
    const fetchFn = sequencia(resposta('• ok'))
    await criar(['a'], fetchFn).sugerir(dados)
    expect(chamada(fetchFn, 0).init.signal).toBeInstanceOf(AbortSignal)
  })

  it('avisos e erros não vazam a chave', async () => {
    const fetchFn = sequencia(resposta('', 500), new Error('rede caiu'), resposta('• ok'))
    await criar(['a', 'b', 'c'], fetchFn).sugerir(dados)
    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toContain('chave-secreta')
  })
})

describe('limparSugestoes: marcadores x números', () => {
  it.each([['1.500 em mercado é muito'], ['10.000 reais guardados']])('número no início fica intacto: %j', (texto) => {
    expect(limparSugestoes(texto)).toEqual([texto])
  })

  it.each([['1. Reduza o mercado', 'Reduza o mercado'], ['2) Monte uma reserva', 'Monte uma reserva'], ['- Corte gastos', 'Corte gastos'], ['* Corte gastos', 'Corte gastos'], ['• Corte gastos', 'Corte gastos']])(
    'marcador %j é removido',
    (texto, esperado) => {
      expect(limparSugestoes(texto)).toEqual([esperado])
    },
  )
})
