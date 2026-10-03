import { formatBRL, formatValor, parseValor } from './money'
import { parse } from './parser'

// O que a IA leu da foto, já validado. Ela só transcreve: nada aqui foi calculado por ela.
export type Leitura = {
  legivel: boolean
  emitente: string | null
  data: string | null // AAAA-MM-DD, data real
  total: number | null // centavos
  categoria: string | null // sugestão crua; montarPrevia limpa
}
export type Legenda = { natureza: 'despesa' | 'receita'; categoria?: string; apelido?: string }

export const NOTA_ILEGIVEL = '🤖 Não consegui ler o total desta nota. Envie outra foto (reta, inteira, sem reflexo) ou lance com /d.'
export const NOTA_SEM_COMANDO = '🤖 Li a nota, mas não consegui montar o lançamento. Confira a legenda (ex.: /nota mercado @principal) ou lance com /d.'
export const NOTA_FALHOU = '🤖 A leitura da nota falhou agora. Tente de novo em instantes ou lance com /d.'
export const NOTA_LIMITE = '🤖 Limite de 20 notas por hora atingido. Tente mais tarde ou lance com /d.'
export const NOTA_ARQUIVO = '🤖 Só leio fotos JPEG, PNG ou WebP de até 5 MB.'
export const NOTA_DESLIGADA = '🤖 A leitura de notas não está configurada (defina OPENROUTER_VISION_MODEL).'

const DECIMAL = /^\d{1,9}\.\d{2}$/ // exige 2 casas: "45.900" seria lido pelo parseValor como R$ 45.900,00
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/
const DIA_MS = 86_400_000

const centavos = (v: unknown) => (typeof v === 'string' && DECIMAL.test(v) ? parseValor(v) : null)
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const br = (iso: string) => iso.split('-').reverse().join('/')
const diaLocal = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10) // offset fixo -03:00, como em period.ts

function dataReal(v: unknown): string | null {
  const m = typeof v === 'string' ? DATA.exec(v) : null
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === v ? v : null
}

function limparCategoria(s: string | null | undefined): string | null {
  const c = (s ?? '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim()
  return /^\p{L}/u.test(c) ? c : null
}

export function validarLeitura(json: unknown): Leitura | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.legivel !== 'boolean') return null
  return { legivel: o.legivel, emitente: texto(o.emitente), data: dataReal(o.data_emissao), total: centavos(o.total), categoria: texto(o.categoria) }
}

// "/nota [r|d] [categoria...] [@conta]"; null = não é pedido de nota
export function lerLegenda(legenda: string): Legenda | null {
  const [palavra, ...args] = legenda.trim().toLowerCase().split(/\s+/)
  if (palavra !== '/nota') return null
  const natureza = args[0] === 'r' ? 'receita' : 'despesa'
  if (args[0] === 'r' || args[0] === 'd') args.shift()
  const apelido = args.find((a) => a.startsWith('@'))?.slice(1) // formato validado pelo parser ao montar o comando
  const categoria = limparCategoria(args.filter((a) => !a.startsWith('@')).join(' '))
  return { natureza, ...(categoria && { categoria }), ...(apelido !== undefined && { apelido }) }
}

// A última linha é sempre o comando: é ela que o /ok executa.
export function montarPrevia(l: Leitura, legenda: Legenda, hoje: Date): string {
  if (!l.legivel || l.total === null) return NOTA_ILEGIVEL
  const alertas: string[] = []
  let data = l.data
  if (!data) alertas.push('não li a data; vale a do lançamento (hoje)')
  else if (data > diaLocal(hoje) || data < diaLocal(new Date(hoje.getTime() - 366 * DIA_MS))) {
    alertas.push(`a data lida (${br(data)}) parece errada; vale a do lançamento (hoje)`)
    data = null
  }
  const categoria = legenda.categoria ?? limparCategoria(l.categoria) ?? 'outros'
  const partes = [legenda.natureza === 'receita' ? '/r' : '/d', categoria, formatValor(l.total)]
  if (data) partes.push(br(data))
  if (legenda.apelido !== undefined) partes.push(`@${legenda.apelido}`)
  const comando = partes.join(' ')
  if (parse(comando)?.tipo !== 'lancamento') return NOTA_SEM_COMANDO

  const linhas = ['🤖 *Nota lida pela IA* _(sugestão: confira antes de lançar)_']
  if (l.emitente) linhas.push(`Emitente: ${l.emitente.replace(/\s+/g, ' ').trim().slice(0, 60)}`)
  linhas.push(`Data: ${data ? br(data) : 'hoje'}`, `Total: ${formatBRL(l.total)}`, ...alertas.map((a) => `⚠️ ${a}`))
  linhas.push('', 'Para lançar, responda a esta mensagem com /ok.', 'Para corrigir, copie a linha abaixo, ajuste e envie.', '', comando)
  return linhas.join('\n')
}

export function comandoDaPrevia(t: string): string | null {
  const ultimaLinha = t.trim().split('\n').pop()?.trim() ?? ''
  return /^\/[dr] /.test(ultimaLinha) ? ultimaLinha : null
}
