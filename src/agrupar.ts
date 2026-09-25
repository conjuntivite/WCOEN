export interface Agrupador {
  // devolve, dentre `contas`, as que se relacionam com `termo`; pode lançar (todos os modelos falharam)
  agrupar(termo: string, contas: string[]): Promise<string[]>
}

// A IA às vezes cerca o JSON com texto ou com bloco de código, e às vezes inventa nomes: só passam os que existem em `contas`.
// null = resposta fora do combinado (falha, aciona o próximo modelo); [] = resposta válida sem nenhuma conta utilizável.
export function lerContasDaResposta(texto: string, contas: string[]): string[] | null {
  const m = /\{[\s\S]*\}/.exec(texto)
  if (!m) return null
  let dados: { contas?: unknown }
  try {
    dados = JSON.parse(m[0])
  } catch {
    return null
  }
  if (!Array.isArray(dados.contas)) return null

  const porNome = new Map(contas.map((c) => [c.toLowerCase(), c]))
  const escolhidas = dados.contas.map((c) => (typeof c === 'string' ? porNome.get(c.trim().toLowerCase()) : undefined))
  return [...new Set(escolhidas.filter((c): c is string => c !== undefined))]
}

const PROMPT =
  'Você ajuda num controle financeiro pessoal. Recebe um JSON {"termo": "...", "contas": [...]}, em que "contas" são ' +
  'nomes de contas lançadas pelo usuário. Responda SOMENTE com um JSON {"contas": [...]} contendo as contas da lista ' +
  'que se relacionam com o termo (exemplo: termo "carro" inclui gasolina, óleo, mecânico, peças, retífica). ' +
  'Seja conservador: na dúvida, NÃO inclua a conta. Use os nomes exatamente como aparecem na lista. ' +
  'Se nenhuma se relaciona, responda {"contas": []}.'

const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'
const PRAZO_TENTATIVA_MS = 15_000
const PRAZO_TOTAL_MS = 40_000

export type OpcoesOpenRouter = { apiKey: string; models: string[]; fetchFn?: typeof fetch } // models em ordem de tentativa

export function criarAgrupadorOpenRouter({ apiKey, models, fetchFn = fetch }: OpcoesOpenRouter): Agrupador {
  async function tentar(model: string, termo: string, contas: string[]): Promise<string[]> {
    const resp = await fetchFn(URL_OPENROUTER, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: JSON.stringify({ termo, contas }) }, // só nomes: nunca valores, datas ou remetentes
        ],
      }),
      signal: AbortSignal.timeout(PRAZO_TENTATIVA_MS),
    })
    if (!resp.ok) throw new Error(`OpenRouter (${model}) respondeu ${resp.status}`)
    const dados = (await resp.json()) as { choices?: { message?: { content?: string } }[] }
    const escolhidas = lerContasDaResposta(dados.choices?.[0]?.message?.content ?? '', contas)
    if (!escolhidas) throw new Error(`OpenRouter (${model}) respondeu fora do combinado`)
    return escolhidas
  }

  return {
    async agrupar(termo, contas) {
      const limite = Date.now() + PRAZO_TOTAL_MS
      let ultimoErro: Error = new Error('nenhum modelo configurado para a IA')
      for (const model of models) {
        if (Date.now() > limite) break
        try {
          return await tentar(model, termo, contas)
        } catch (err) {
          ultimoErro = err instanceof Error ? err : new Error(String(err))
          console.warn(`IA: ${model} falhou (${ultimoErro.message}); tentando o próximo modelo`)
        }
      }
      throw ultimoErro
    },
  }
}
