import { parseValor } from './money'
import type { DataLanc, Natureza } from './types'

export type Relatorio = 'mensal' | 'semanal' | 'anual'

export type Comando =
  | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc }
  | { tipo: 'balancete'; relatorio: Relatorio }
  | { tipo: 'uso'; comando: 'balancete' | 'auditoria' } // uso incorreto: o service responde a dica
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }

const RESERVADAS = ['balancete', 'auditoria', 'desfazer', 'ajuda']
const MAX_CONTA = 40
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

  const b = /^balancete(?: (.*))?$/.exec(t)
  if (b) {
    const relatorio = b[1] ?? 'mensal'
    return relatorio === 'mensal' || relatorio === 'semanal' || relatorio === 'anual'
      ? { tipo: 'balancete', relatorio }
      : { tipo: 'uso', comando: 'balancete' }
  }
  if (t === 'auditoria' || t.startsWith('auditoria ')) return null // reservada: vira comando na próxima etapa

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
  const valor = parseValor(valorPrimeiro ? itens[0] : itens[itens.length - 1])
  const conta = (valorPrimeiro ? itens.slice(1) : itens.slice(0, -1)).join(' ')
  // conta começar com letra também barra as respostas do próprio bot (🟢, 🔴, 🤖, ↩️, ⚠️...)
  if (valor === null || conta.length > MAX_CONTA || !/^\p{L}/u.test(conta)) return null

  return { tipo: 'lancamento', natureza: sinal === '+' ? 'receita' : 'despesa', conta, valor, ...(data && { data }) }
}
