import { parseValor } from './money'
import type { DataLanc, Filtro, Natureza } from './types'

export type Periodo =
  | { tipo: 'mes-atual' }
  | { tipo: 'tudo' }
  | { tipo: 'mes'; ano: number; mes: number }
  | { tipo: 'semana'; passada: boolean }
  | { tipo: 'trimestre' }
  | { tipo: 'ano'; ano?: number }

export type FiltroPedido = Filtro | { tipo: 'tema'; termo: string } // tema = "ia <termo>": pede o agrupamento por IA

export type Comando =
  | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc }
  | { tipo: 'balancete'; periodo: Periodo; filtro?: FiltroPedido }
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }

const RESERVADAS = ['balancete', 'desfazer', 'ajuda']
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

// balancete [período] [filtro]; o período é opcional (mês atual), o filtro também
const BALANCETE = /^balancete(?: (tudo|semana passada|semana|trimestre|ano|\d{2}\/\d{4}|\d{4}))?(?: (.+))?$/

function lerPeriodo(p: string | undefined): Periodo | null {
  if (p === undefined) return { tipo: 'mes-atual' }
  if (p === 'tudo' || p === 'trimestre' || p === 'ano') return { tipo: p }
  if (p === 'semana' || p === 'semana passada') return { tipo: 'semana', passada: p === 'semana passada' }
  const mensal = /^(\d{2})\/(\d{4})$/.exec(p)
  if (mensal) {
    const mes = Number(mensal[1])
    const ano = Number(mensal[2])
    return mes >= 1 && mes <= 12 && ano >= 2000 ? { tipo: 'mes', ano, mes } : null
  }
  const ano = Number(p) // sobraram os 4 dígitos: "balancete 2025"
  return ano >= 2000 ? { tipo: 'ano', ano } : null
}

function lerBalancete(p: string | undefined, f: string | undefined): Comando | null {
  const periodo = lerPeriodo(p)
  if (!periodo) return null
  let filtro: FiltroPedido | undefined
  if (f === 'receitas') filtro = { tipo: 'natureza', natureza: 'receita' }
  else if (f === 'despesas') filtro = { tipo: 'natureza', natureza: 'despesa' }
  else if (f !== undefined) {
    const tema = /^ia (.+)$/.exec(f) // "ia carro": pede o agrupamento por IA; sem "ia", é o nome de uma conta
    const nome = tema ? tema[1] : f
    if (f === 'ia' || nome.length > MAX_CONTA || !/^\p{L}/u.test(nome)) return null
    filtro = tema ? { tipo: 'tema', termo: nome } : { tipo: 'conta', conta: nome }
  }
  return { tipo: 'balancete', periodo, ...(filtro && { filtro }) }
}

export function parse(texto: string): Comando | null {
  if (/[\r\n]/.test(texto.trim())) return null // várias linhas: conversa, não comando

  const t = texto.trim().replace(/r\$\s*/gi, '').replace(/\s+/g, ' ').toLowerCase()
  if (t === 'ajuda') return { tipo: 'ajuda' }
  if (t === 'desfazer') return { tipo: 'desfazer' }

  const b = BALANCETE.exec(t)
  if (b) return lerBalancete(b[1], b[2])

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
