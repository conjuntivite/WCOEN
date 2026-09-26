import { parseValor } from './money'
import type { DataLanc, Natureza } from './types'

export type Relatorio = 'mensal' | 'semanal' | 'anual'

export type Comando =
  | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc }
  | { tipo: 'balancete'; relatorio: Relatorio }
  | { tipo: 'auditoria'; relatorio: Relatorio }
  | { tipo: 'uso'; comando: 'balancete' | 'auditoria' } // uso incorreto: o service responde a dica
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }

const RESERVADAS = ['balancete', 'auditoria', 'desfazer', 'ajuda']
const MAX_CONTA = 40

// Palavras que, no começo da descrição e sem sinal, marcam receita (sem acento, minúsculas).
// Ambíguas como "pix", "pagamento" e "aluguel" ficam de fora de propósito: para elas vale o "+".
const RECEITAS = [
  'salario', 'decimo terceiro', 'plantao', 'freela', 'freelance', 'comissao', 'bonus',
  'venda', 'vendas', 'reembolso', 'rendimento', 'rendimentos', 'pro-labore', 'prolabore',
]
const semAcento = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')
const indicaReceita = (conta: string) => {
  const c = semAcento(conta)
  return RECEITAS.some((p) => c === p || c.startsWith(p + ' '))
}
const RELATIVAS = new Map([['hoje', 0], ['ontem', 1], ['anteontem', 2]])
const DIA_MES = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/

function lerData(token: string): DataLanc | null {
  const diasAtras = RELATIVAS.get(token)
  if (diasAtras !== undefined) return { tipo: 'relativa', diasAtras }
  const m = DIA_MES.exec(token)
  if (!m) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  const ano = m[3] ? Number(m[3]) : undefined
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || (ano !== undefined && ano < 2000)) return null
  return { tipo: 'dia', dia, mes, ano }
}

export function parse(texto: string): Comando | null {
  if (/[\r\n]/.test(texto.trim())) return null // várias linhas: conversa, não comando

  const t = texto.trim().replace(/r\$\s*/gi, '').replace(/\s+/g, ' ').toLowerCase()
  if (t === 'ajuda') return { tipo: 'ajuda' }
  if (t === 'desfazer') return { tipo: 'desfazer' }

  const rel = /^(balancete|auditoria)(?: (.*))?$/.exec(t)
  if (rel) {
    const comando = rel[1] as 'balancete' | 'auditoria'
    const relatorio = rel[2] ?? 'mensal'
    if (relatorio !== 'mensal' && relatorio !== 'semanal' && relatorio !== 'anual') return { tipo: 'uso', comando }
    return comando === 'balancete' ? { tipo: 'balancete', relatorio } : { tipo: 'auditoria', relatorio }
  }

  // "+" marca receita e "-" marca despesa; sem sinal é despesa (ex.: "mercado 45,90")
  const sinal = t.startsWith('+') || t.startsWith('-') ? t[0] : null
  const partes = (sinal ? t.slice(1).trim() : t).split(' ')
  if (partes.length < 2 || RESERVADAS.includes(partes[0])) return null

  // data opcional no fim: "ontem", "15/09", "15/09/2026". Sem ela, o service usa a data de envio da mensagem.
  const data = lerData(partes[partes.length - 1])
  const fim = data ? partes.length - 1 : partes.length
  if (fim < 2) return null

  // com sinal o valor pode vir primeiro ("+ 70 plantão") ou por último ("+ plantão 70"); sem sinal, só por último
  const itens = partes.slice(0, fim)
  const valorPrimeiro = sinal !== null && parseValor(itens[0]) !== null
  if (valorPrimeiro && parseValor(itens[itens.length - 1]) !== null) return null // ambíguo ("- 2 cafés 10"): não adivinha dinheiro
  const valor = parseValor(valorPrimeiro ? itens[0] : itens[itens.length - 1])
  const conta = (valorPrimeiro ? itens.slice(1) : itens.slice(0, -1)).join(' ')
  // conta começar com letra também barra as respostas do próprio bot (🟢, 🔴, 🤖, ↩️, ⚠️...)
  if (valor === null || conta.length > MAX_CONTA || !/^\p{L}/u.test(conta) || RESERVADAS.includes(conta.split(' ')[0])) return null

  // o sinal explícito manda; sem sinal, uma palavra de receita no começo da descrição marca receita
  const natureza = sinal === '+' ? 'receita' : sinal === '-' ? 'despesa' : indicaReceita(conta) ? 'receita' : 'despesa'

  return { tipo: 'lancamento', natureza, conta, valor, ...(data && { data }) }
}
