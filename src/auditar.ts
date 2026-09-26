export type DadosAuditoria = {
  periodo: string // rótulo, ex.: "09/2026"
  receitas: string // valores já formatados, ex.: "R$ 3.000,00": a IA nunca calcula
  despesas: string
  saldo: string
  rankingDespesas: { conta: string; valor: string; percentual: number }[] // até 5, do maior para o menor
  receitasPorConta: { conta: string; valor: string }[]
  comparacao?: { periodo: string; receitas: string; despesas: string; saldo: string } // período anterior, se houver movimento
  lancamentos: { data: string; tipo: 'receita' | 'despesa'; conta: string; valor: string }[] // no máximo os 200 mais recentes
}

export interface Auditor {
  // até 5 sugestões, sem o "• " inicial; pode lançar (todos os modelos falharam)
  sugerir(dados: DadosAuditoria): Promise<string[]>
}

// Uma sugestão por linha; tira marcadores ("•", "-", "*", "1.", "1)"), corta em 200 caracteres e mantém 5. null = nada aproveitável.
export function limparSugestoes(texto: string): string[] | null {
  const sugestoes = texto
    .split('\n')
    .map((l) => l.trim().replace(/^(?:[-*•]\s*|\d+[.)]\s+)/, '').trim())
    .filter(Boolean)
    .map((s) => (s.length > 200 ? `${s.slice(0, 199)}…` : s))
    .slice(0, 5)
  return sugestoes.length ? sugestoes : null
}

const PROMPT =
  'Você é um consultor de finanças pessoais. Recebe um JSON com o resumo e os lançamentos de um período. ' +
  'Use SOMENTE os números fornecidos, nunca invente ou recalcule valores. ' +
  'Responda em português com 3 a 5 sugestões curtas, uma por linha, cada uma começando com "• ", sem títulos e sem formatação. ' +
  'Aponte os maiores gastos, variações em relação ao período anterior e formas práticas de economizar. ' +
  'Se houver poucos dados, diga isso em uma linha.'

const URL_OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'
const PRAZO_TENTATIVA_MS = 30_000
const PRAZO_TOTAL_MS = 45_000

export type OpcoesOpenRouter = { apiKey: string; models: string[]; fetchFn?: typeof fetch } // models em ordem de tentativa (só pagos)

export function criarAuditorOpenRouter({ apiKey, models, fetchFn = fetch }: OpcoesOpenRouter): Auditor {
  async function tentar(model: string, dados: DadosAuditoria, prazoMs: number): Promise<string[]> {
    const resp = await fetchFn(URL_OPENROUTER, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: JSON.stringify(dados) },
        ],
      }),
      signal: AbortSignal.timeout(prazoMs),
    })
    if (!resp.ok) throw new Error(`OpenRouter (${model}) respondeu ${resp.status}`)
    const corpo = (await resp.json()) as { choices?: { message?: { content?: string } }[] }
    const sugestoes = limparSugestoes(corpo.choices?.[0]?.message?.content ?? '')
    if (!sugestoes) throw new Error(`OpenRouter (${model}) respondeu fora do combinado`)
    return sugestoes
  }

  return {
    async sugerir(dados) {
      const inicio = Date.now()
      let ultimoErro: Error = new Error('nenhum modelo configurado para a IA')
      for (const model of models) {
        const restante = PRAZO_TOTAL_MS - (Date.now() - inicio)
        if (restante <= 0) break
        try {
          return await tentar(model, dados, Math.min(PRAZO_TENTATIVA_MS, restante))
        } catch (err) {
          ultimoErro = err instanceof Error ? err : new Error(String(err))
          console.warn(`IA: ${model} falhou (${ultimoErro.message}); tentando o próximo modelo`)
        }
      }
      throw ultimoErro
    },
  }
}
