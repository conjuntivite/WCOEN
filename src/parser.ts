import { parseValor } from './money'
import type { DataLanc, Natureza } from './types'

export type Relatorio = 'mensal' | 'semanal' | 'anual'

export type Comando =
  | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc }
  | { tipo: 'balancete'; relatorio: 'hoje' | Relatorio } // 'hoje' = extrato do dia
  | { tipo: 'auditoria'; relatorio: Relatorio }
  | { tipo: 'extrato'; pagina: number } // extrato completo da conta, paginado
  | { tipo: 'uso'; comando: 'balancete' | 'auditoria' | 'extrato' | 'despesa' | 'receita' } // uso incorreto: o service responde a dica
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }

const MAX_CONTA = 40

// só vale mensagem que começa com "/"; "/d" é despesa, por isso desfazer não tem atalho
type Nome = 'despesa' | 'receita' | 'balancete' | 'extrato' | 'auditoria' | 'desfazer' | 'ajuda'
const COMANDOS = new Map<string, Nome>([
  ['d', 'despesa'], ['despesa', 'despesa'], ['r', 'receita'], ['receita', 'receita'],
  ['b', 'balancete'], ['balancete', 'balancete'], ['e', 'extrato'], ['extrato', 'extrato'],
  ['a', 'auditoria'], ['auditoria', 'auditoria'], ['desfazer', 'desfazer'], ['h', 'ajuda'], ['ajuda', 'ajuda'],
])
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
  if (!t.startsWith('/')) return null
  const [palavra, ...args] = t.slice(1).split(' ')
  const nome = COMANDOS.get(palavra)
  if (!nome) return null // "/xyz" desconhecido: pode ser de outro bot
  const resto = args.join(' ')

  if (nome === 'ajuda' || nome === 'desfazer') return resto ? null : { tipo: nome }

  if (nome === 'extrato') {
    const pagina = resto || '1'
    return /^\d{1,6}$/.test(pagina) && Number(pagina) >= 1 ? { tipo: 'extrato', pagina: Number(pagina) } : { tipo: 'uso', comando: 'extrato' }
  }

  if (nome === 'balancete' || nome === 'auditoria') {
    const relatorio = resto || (nome === 'balancete' ? 'hoje' : 'mensal')
    if (relatorio === 'hoje' && nome === 'balancete') return { tipo: 'balancete', relatorio }
    if (relatorio !== 'mensal' && relatorio !== 'semanal' && relatorio !== 'anual') return { tipo: 'uso', comando: nome }
    return nome === 'balancete' ? { tipo: 'balancete', relatorio } : { tipo: 'auditoria', relatorio }
  }

  // "/d conta valor [data]": data opcional no fim ("ontem", "15/09", "15/09/2026"); sem ela, o service usa a data de envio
  const data = args.length ? lerData(args[args.length - 1]) : null
  const itens = data ? args.slice(0, -1) : args
  const valor = itens.length >= 2 ? parseValor(itens[itens.length - 1]) : null
  const conta = itens.slice(0, -1).join(' ')
  if (valor === null || conta.length > MAX_CONTA || !/^\p{L}/u.test(conta)) return { tipo: 'uso', comando: nome }

  return { tipo: 'lancamento', natureza: nome, conta, valor, ...(data && { data }) }
}
