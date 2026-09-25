import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { criarAgrupadorOpenRouter, lerContasDaResposta } from '../src/agrupar'

const contas = ['gasolina', 'mercado', 'óleo', 'retífica']

describe('lerContasDaResposta', () => {
  it('lê o JSON limpo', () => {
    expect(lerContasDaResposta('{"contas": ["gasolina", "óleo"]}', contas)).toEqual(['gasolina', 'óleo'])
  })

  it('aceita JSON dentro de cerca de código e com texto em volta', () => {
    const cerca = '`'.repeat(3)
    const texto = `Claro!\n${cerca}json\n{"contas": ["retífica"]}\n${cerca}\nEspero ter ajudado.`
    expect(lerContasDaResposta(texto, contas)).toEqual(['retífica'])
  })

  it('descarta nomes que não existem na lista, ignora maiúsculas e repetições', () => {
    const texto = '{"contas": ["Gasolina", "gasolina", "pneu", "mercado ", 42, null]}'
    expect(lerContasDaResposta(texto, contas)).toEqual(['gasolina', 'mercado'])
  })

  it('JSON válido sem nenhum nome utilizável é resposta legítima: []', () => {
    expect(lerContasDaResposta('{"contas": []}', contas)).toEqual([])
    expect(lerContasDaResposta('{"contas": ["pneu"]}', contas)).toEqual([])
  })

  it.each([[''], ['sem json aqui'], ['{quebrado'], ['{"outra": []}'], ['{"contas": "gasolina"}']])(
    'resposta fora do combinado (%j) devolve null',
    (texto) => {
      expect(lerContasDaResposta(texto, contas)).toBeNull()
    },
  )
})

describe('criarAgrupadorOpenRouter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
    criarAgrupadorOpenRouter({ apiKey: 'chave-secreta', models, fetchFn: fetchFn as unknown as typeof fetch })

  const corpoDaChamada = (fetchFn: ReturnType<typeof sequencia>, n: number) => {
    const [, init] = fetchFn.mock.calls[n] as unknown as [string, RequestInit]
    return JSON.parse(init.body as string)
  }

  it('chama o OpenRouter com chave, modelo e só os nomes das contas', async () => {
    const fetchFn = sequencia(resposta('{"contas": ["gasolina", "óleo"]}'))

    expect(await criar(['um/modelo'], fetchFn).agrupar('carro', contas)).toEqual(['gasolina', 'óleo'])

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer chave-secreta')
    const corpo = corpoDaChamada(fetchFn, 0)
    expect(corpo.model).toBe('um/modelo')
    expect(corpo.temperature).toBe(0)
    expect(corpo.messages[1].content).toBe(JSON.stringify({ termo: 'carro', contas })) // só nomes: sem valores nem datas
  })

  it('modelo pago falha com erro HTTP: usa o próximo (gratuito)', async () => {
    const fetchFn = sequencia(resposta('', 500), resposta('{"contas": ["gasolina"]}'))
    const r = await criar(['pago/x', 'gratis/y:free'], fetchFn).agrupar('carro', contas)
    expect(r).toEqual(['gasolina'])
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(corpoDaChamada(fetchFn, 0).model).toBe('pago/x')
    expect(corpoDaChamada(fetchFn, 1).model).toBe('gratis/y:free')
  })

  it('erro de rede ou timeout também passa para o próximo', async () => {
    const fetchFn = sequencia(new Error('rede caiu'), resposta('{"contas": ["óleo"]}'))
    expect(await criar(['pago/x', 'gratis/y:free'], fetchFn).agrupar('carro', contas)).toEqual(['óleo'])
  })

  it('resposta fora do combinado do modelo pago passa para o próximo', async () => {
    const fetchFn = sequencia(resposta('não sei responder isso'), resposta('{"contas": ["retífica"]}'))
    expect(await criar(['pago/x', 'gratis/y:free'], fetchFn).agrupar('carro', contas)).toEqual(['retífica'])
  })

  it('resposta sem conteúdo conta como falha', async () => {
    const fetchFn = sequencia(new Response(JSON.stringify({ choices: [] }), { status: 200 }), resposta('{"contas": ["óleo"]}'))
    expect(await criar(['pago/x', 'gratis/y:free'], fetchFn).agrupar('carro', contas)).toEqual(['óleo'])
  })

  it('lista vazia válida NÃO aciona o fallback', async () => {
    const fetchFn = sequencia(resposta('{"contas": []}'))
    expect(await criar(['pago/x', 'gratis/y:free'], fetchFn).agrupar('carro', contas)).toEqual([])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('todos os modelos falham: lança o último erro', async () => {
    const fetchFn = sequencia(resposta('', 500), resposta('', 429))
    await expect(criar(['a', 'b'], fetchFn).agrupar('carro', contas)).rejects.toThrow('OpenRouter (b) respondeu 429')
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('sem modelos configurados: falha sem chamar a rede', async () => {
    const fetchFn = sequencia()
    await expect(criar([], fetchFn).agrupar('carro', contas)).rejects.toThrow('nenhum modelo')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('o aviso de falha não vaza a chave', async () => {
    const fetchFn = sequencia(resposta('', 500), resposta('{"contas": ["óleo"]}'))
    await criar(['pago/x', 'gratis/y:free'], fetchFn).agrupar('carro', contas)
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('chave-secreta')
  })
})
