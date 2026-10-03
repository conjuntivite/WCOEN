import { parseValor } from './money'
import type { DataLanc, Natureza } from './types'

export type Relatorio = 'mensal' | 'semanal' | 'anual'

export type Comando =
  | { tipo: 'lancamento'; natureza: Natureza; conta: string; valor: number; data?: DataLanc; contaCorrente?: string }
  | { tipo: 'balancete'; relatorio: 'hoje' | Relatorio; contaCorrente?: string } // 'hoje' = extrato do dia
  | { tipo: 'auditoria'; relatorio: Relatorio }
  | { tipo: 'extrato'; pagina: number; contaCorrente?: string } // extrato completo da conta, paginado
  | { tipo: 'contas' } // lista as contas correntes
  | { tipo: 'uso'; comando: 'balancete' | 'auditoria' | 'extrato' | 'despesa' | 'receita' | 'transferencia' } // uso incorreto: o service responde a dica
  | { tipo: 'transferencia'; valor: number; data?: DataLanc; origem?: string; destino: string } // origem ausente = a conta favorita
  | { tipo: 'desfazer' }
  | { tipo: 'ajuda' }

const MAX_CONTA = 40

// só vale mensagem que começa com "/"; "/d" é despesa, por isso desfazer não tem atalho
type Nome = 'despesa' | 'receita' | 'balancete' | 'extrato' | 'auditoria' | 'desfazer' | 'ajuda' | 'contas' | 'transferencia'
const COMANDOS = new Map<string, Nome>([
  ['d', 'despesa'], ['despesa', 'despesa'], ['r', 'receita'], ['receita', 'receita'],
  ['b', 'balancete'], ['balancete', 'balancete'], ['e', 'extrato'], ['extrato', 'extrato'],
  ['a', 'auditoria'], ['auditoria', 'auditoria'], ['desfazer', 'desfazer'], ['h', 'ajuda'], ['ajuda', 'ajuda'],
  ['c', 'contas'], ['contas', 'contas'], ['saldo', 'contas'],
  ['t', 'transferencia'], ['transferencia', 'transferencia'],
])
const RELATIVAS = new Map([['hoje', 0], ['ontem', 1], ['anteontem', 2]])
const DIA_MES = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/
const APELIDO = /^@([a-z0-9_-]{1,20})$/ // a mensagem já chega minúscula

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
  if (nome === 'ajuda' || nome === 'desfazer' || nome === 'contas') return args.length ? null : { tipo: nome }

  // "@apelido" (a conta corrente) vale em qualquer posição; no máximo um, e no formato certo
  const marcas = args.filter((a) => a.startsWith('@'))
  const palavras = args.filter((a) => !a.startsWith('@'))
  const apelido = marcas.length === 1 ? APELIDO.exec(marcas[0])?.[1] : undefined
  const marcaInvalida = marcas.length > 1 || (marcas.length === 1 && !apelido)
  const cc = apelido ? { contaCorrente: apelido } : {}
  const resto = palavras.join(' ')

  // "/t valor @origem @destino [data]": com um @ só, é o destino e a origem é a favorita (o service resolve)
  if (nome === 'transferencia') {
    const apelidos = marcas.map((m) => APELIDO.exec(m)?.[1])
    const data = palavras.length ? lerData(palavras[palavras.length - 1]) : null
    const itens = data ? palavras.slice(0, -1) : palavras
    const valor = itens.length === 1 ? parseValor(itens[0]) : null
    if (valor === null || apelidos.length < 1 || apelidos.length > 2 || apelidos.some((a) => !a)) return { tipo: 'uso', comando: 'transferencia' }
    const [primeiro, segundo] = apelidos as string[]
    return { tipo: 'transferencia', valor, ...(data && { data }), ...(segundo ? { origem: primeiro, destino: segundo } : { destino: primeiro }) }
  }

  if (nome === 'extrato') {
    const pagina = resto || '1'
    return !marcaInvalida && /^\d{1,6}$/.test(pagina) && Number(pagina) >= 1 ? { tipo: 'extrato', pagina: Number(pagina), ...cc } : { tipo: 'uso', comando: 'extrato' }
  }

  if (nome === 'balancete' || nome === 'auditoria') {
    if (nome === 'auditoria' && marcas.length) return { tipo: 'uso', comando: nome } // a auditoria é sempre consolidada
    const relatorio = resto || (nome === 'balancete' ? 'hoje' : 'mensal')
    const valido = relatorio === 'mensal' || relatorio === 'semanal' || relatorio === 'anual' || (relatorio === 'hoje' && nome === 'balancete')
    if (!valido || marcaInvalida) return { tipo: 'uso', comando: nome }
    return nome === 'balancete' ? { tipo: 'balancete', relatorio, ...cc } : { tipo: 'auditoria', relatorio: relatorio as Relatorio }
  }

  // "/d conta valor [data] [@conta]": data opcional no fim ("ontem", "15/09", "15/09/2026"); sem ela, o service usa a data de envio
  const data = palavras.length ? lerData(palavras[palavras.length - 1]) : null
  const itens = data ? palavras.slice(0, -1) : palavras
  const valor = itens.length >= 2 ? parseValor(itens[itens.length - 1]) : null
  const conta = itens.slice(0, -1).join(' ')
  if (marcaInvalida || valor === null || conta.length > MAX_CONTA || !/^\p{L}/u.test(conta)) return { tipo: 'uso', comando: nome }

  return { tipo: 'lancamento', natureza: nome, conta, valor, ...(data && { data }), ...cc }
}
