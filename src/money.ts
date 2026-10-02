const MAX_CENTAVOS = 100_000_000_000 // R$ 1 bilhão; acima disso é lixo, não dinheiro
const COM_MILHAR = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/ // 1.234,56 | 1.234
const SIMPLES = /^\d+([.,]\d{1,2})?$/ // 45 | 45,90 | 45.90

export function parseValor(s: string): number | null {
  const t = s.replace(/r\$/gi, '').trim()
  let normal: string
  if (COM_MILHAR.test(t)) normal = t.replace(/\./g, '').replace(',', '.')
  else if (SIMPLES.test(t)) normal = t.replace(',', '.')
  else return null
  const [inteiro, dec = ''] = normal.split('.')
  const centavos = Number(inteiro) * 100 + Number(dec.padEnd(2, '0'))
  return centavos > 0 && centavos <= MAX_CENTAVOS ? centavos : null
}

export function formatValor(centavos: number): string {
  const abs = Math.abs(centavos)
  const inteiro = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${inteiro},${String(abs % 100).padStart(2, '0')}`
}

export function formatBRL(centavos: number): string {
  return `${centavos < 0 ? '-' : ''}R$ ${formatValor(centavos)}`
}

// saldo inicial digitado no portal: vazio = 0; aceita sinal "-" (parseValor só aceita positivos)
export function parseSaldo(s: string): number | null {
  const t = s.trim()
  if (t === '') return 0
  const negativo = t.startsWith('-')
  const v = parseValor(negativo ? t.slice(1).trim() : t)
  if (v !== null) return negativo ? -v : v
  return /^-?\s*0+([.,]0{1,2})?$/.test(t) ? 0 : null
}
