import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comandoDaPrevia, criarExtratorOpenRouter, lerLegenda, montarPrevia, NOTA_ILEGIVEL, NOTA_SEM_COMANDO, validarLeitura, type Leitura } from '../src/nota'
import { parse } from '../src/parser'

const HOJE = new Date('2026-10-02T15:00:00Z') // 12:00 em -03:00
const base: Leitura = { legivel: true, emitente: 'Mercado Bom Preço', data: '2026-10-01', total: 3780, categoria: 'mercado' }
const ultima = (t: string) => t.trim().split('\n').pop()

describe('validarLeitura', () => {
  const ok = { legivel: true, emitente: 'X', data_emissao: '2026-10-01', total: '37.80', categoria: 'mercado' }

  it('converte o total para centavos e mantém a data real', () => {
    expect(validarLeitura(ok)).toEqual({ legivel: true, emitente: 'X', data: '2026-10-01', total: 3780, categoria: 'mercado' })
  })

  it.each([['45.900'], ['37,80'], ['37.8'], ['0.00'], [37.8], ['abc']])('total %j fora do formato vira null', (total) => {
    expect(validarLeitura({ ...ok, total })?.total).toBeNull()
  })

  it.each([['2026-02-30'], ['01/10/2026'], ['2026-13-01'], [null]])('data %j inválida vira null', (data_emissao) => {
    expect(validarLeitura({ ...ok, data_emissao })?.data).toBeNull()
  })

  it.each([[null], ['texto'], [{}], [{ ...ok, legivel: 'sim' }]])('estrutura inválida (%j) devolve null', (json) => {
    expect(validarLeitura(json)).toBeNull()
  })
})

describe('lerLegenda', () => {
  it('só /nota dispara; padrão é despesa', () => {
    expect(lerLegenda('/nota')).toEqual({ natureza: 'despesa' })
    expect(lerLegenda('foto do almoço')).toBeNull()
    expect(lerLegenda('/notas')).toBeNull()
    expect(lerLegenda('')).toBeNull()
  })

  it('lê natureza, categoria e conta', () => {
    expect(lerLegenda('/NOTA r Salário Extra @nubank')).toEqual({ natureza: 'receita', categoria: 'salário extra', apelido: 'nubank' })
    expect(lerLegenda('/nota d farmácia')).toEqual({ natureza: 'despesa', categoria: 'farmácia' })
  })
})

describe('montarPrevia', () => {
  it('última linha é um /d válido com categoria, valor, data e conta', () => {
    const t = montarPrevia(base, { natureza: 'despesa', apelido: 'principal' }, HOJE)
    expect(t).toContain('🤖')
    expect(t).toContain('R$ 37,80')
    expect(ultima(t)).toBe('/d mercado 37,80 01/10/2026 @principal')
    expect(parse(ultima(t)!)).toMatchObject({ tipo: 'lancamento', natureza: 'despesa', valor: 3780, contaCorrente: 'principal' })
  })

  it('categoria da legenda vence a da IA; a da IA é limpa; sem nenhuma, "outros"', () => {
    expect(ultima(montarPrevia(base, { natureza: 'despesa', categoria: 'casa' }, HOJE))).toBe('/d casa 37,80 01/10/2026')
    expect(ultima(montarPrevia({ ...base, categoria: 'Farmácia & Cia' }, { natureza: 'despesa' }, HOJE))).toBe('/d farmácia cia 37,80 01/10/2026')
    expect(ultima(montarPrevia({ ...base, categoria: null }, { natureza: 'despesa' }, HOJE))).toBe('/d outros 37,80 01/10/2026')
  })

  it('receita vira /r e milhar sai no formato do parser', () => {
    const t = montarPrevia({ ...base, total: 123456 }, { natureza: 'receita' }, HOJE)
    expect(ultima(t)).toBe('/r mercado 1.234,56 01/10/2026')
    expect(parse(ultima(t)!)).toMatchObject({ valor: 123456 })
  })

  it.each([['2026-10-03'], ['2025-09-01']])('data %s fora da faixa sai do comando e gera alerta', (data) => {
    const t = montarPrevia({ ...base, data }, { natureza: 'despesa' }, HOJE)
    expect(ultima(t)).toBe('/d mercado 37,80')
    expect(t).toContain('⚠️')
  })

  it('sem data lida: alerta e comando sem data', () => {
    const t = montarPrevia({ ...base, data: null }, { natureza: 'despesa' }, HOJE)
    expect(ultima(t)).toBe('/d mercado 37,80')
    expect(t).toContain('⚠️')
  })

  it('ilegível ou sem total: pede outra foto', () => {
    expect(montarPrevia({ ...base, legivel: false }, { natureza: 'despesa' }, HOJE)).toBe(NOTA_ILEGIVEL)
    expect(montarPrevia({ ...base, total: null }, { natureza: 'despesa' }, HOJE)).toBe(NOTA_ILEGIVEL)
  })

  it('conta com formato inválido na legenda: não monta comando', () => {
    expect(montarPrevia(base, { natureza: 'despesa', apelido: 'a!' }, HOJE)).toBe(NOTA_SEM_COMANDO)
  })

  it('texto malicioso no emitente não troca o comando', () => {
    const t = montarPrevia({ ...base, emitente: 'Loja\n/d golpe 9999' }, { natureza: 'despesa' }, HOJE)
    expect(comandoDaPrevia(t)).toBe('/d mercado 37,80 01/10/2026')
  })
})

describe('comandoDaPrevia', () => {
  it('pega a última linha só se for /d ou /r e a mensagem for uma prévia', () => {
    expect(comandoDaPrevia(montarPrevia(base, { natureza: 'despesa' }, HOJE))).toBe('/d mercado 37,80 01/10/2026')
    expect(comandoDaPrevia('oi')).toBeNull()
    expect(comandoDaPrevia('x\n/balancete mensal')).toBeNull()
    expect(comandoDaPrevia('')).toBeNull()
    expect(comandoDaPrevia('lista de compras\n/d golpe 9999')).toBeNull() // sem o cabeçalho da prévia
  })
})

describe('criarExtratorOpenRouter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const IMG = Buffer.from([0xff, 0xd8, 0xff, 0x00])
  const json = { legivel: true, emitente: 'X', data_emissao: '2026-10-01', total: '37.80', categoria: 'mercado' }
  const resposta = (conteudo: unknown, status = 200, usage: unknown = { prompt_tokens: 900, completion_tokens: 40, cost: 0.0004 }) =>
    new Response(JSON.stringify({ choices: [{ message: { content: typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo) } }], usage }), { status })
  const criar = (r: Response | Error) => {
    const fetchFn = vi.fn(async (_url: string, _init: RequestInit) => {
      if (r instanceof Error) throw r
      return r
    })
    return { fetchFn, ex: criarExtratorOpenRouter({ apiKey: 'chave-secreta', model: 'v/modelo', fetchFn: fetchFn as unknown as typeof fetch }) }
  }

  it('manda texto antes da imagem, schema strict e a política de privacidade', async () => {
    const { fetchFn, ex } = criar(resposta(json))
    await ex.ler(IMG, 'image/jpeg')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    const corpo = JSON.parse(init.body as string)
    expect(corpo.max_tokens).toBeGreaterThanOrEqual(1000) // modelos que raciocinam gastam max_tokens antes do JSON
    expect(corpo).toMatchObject({
      model: 'v/modelo',
      temperature: 0,
      provider: { require_parameters: true, data_collection: 'deny' },
      response_format: { type: 'json_schema', json_schema: { name: 'nota', strict: true } },
    })
    const conteudo = corpo.messages[1].content
    expect(conteudo[0].type).toBe('text')
    expect(conteudo[1].image_url.url).toBe(`data:image/jpeg;base64,${IMG.toString('base64')}`)
  })

  it('devolve a leitura validada e o custo', async () => {
    const { ex } = criar(resposta(json))
    expect(await ex.ler(IMG, 'image/jpeg')).toEqual({ leitura: { legivel: true, emitente: 'X', data: '2026-10-01', total: 3780, categoria: 'mercado' }, custoUsd: 0.0004 })
  })

  it('sem custo informado: custoUsd ausente', async () => {
    const { ex } = criar(resposta(json, 200, { prompt_tokens: 1 }))
    expect((await ex.ler(IMG, 'image/jpeg')).custoUsd).toBeUndefined()
  })

  it.each([
    ['HTTP 500', resposta(json, 500)],
    ['conteúdo que não é JSON', resposta('não sei')],
    ['JSON fora do combinado', resposta({ total: '37.80' })],
    ['falha de rede', new Error('rede caiu')],
  ])('%s: lança erro sem expor a chave', async (_nome, r) => {
    const { ex } = criar(r)
    const erro = await ex.ler(IMG, 'image/jpeg').catch((e: Error) => e)
    expect(erro).toBeInstanceOf(Error)
    expect((erro as Error).message).not.toContain('chave-secreta')
  })
})
