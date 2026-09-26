import type { DataLanc } from './types'

// ponytail: offset fixo -03:00 (o Brasil aboliu o horário de verão em 2019). Se voltar, trocar por Intl com timeZone.
const OFFSET_H = 3

function diaLocal(ref: Date): { ano: number; mes: number; dia: number } {
  const l = new Date(ref.getTime() - OFFSET_H * 3600_000)
  return { ano: l.getUTCFullYear(), mes: l.getUTCMonth() + 1, dia: l.getUTCDate() }
}

// Date.UTC normaliza dia/mês fora da faixa (dia 0, dia 32...), então somar/subtrair dias é seguro
const meioDia = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes - 1, dia, 12 + OFFSET_H))

export function mesAtual(agora: Date): { ano: number; mes: number } {
  const { ano, mes } = diaLocal(agora)
  return { ano, mes }
}

export function intervaloDoMes(ano: number, mes: number): { de: Date; ate: Date } {
  return {
    de: new Date(Date.UTC(ano, mes - 1, 1, OFFSET_H)),
    ate: new Date(Date.UTC(ano, mes, 1, OFFSET_H)),
  }
}

// semana de domingo 00:00 a domingo 00:00 seguinte (local); deslocamento em semanas
export function intervaloDaSemanaDomingo(agora: Date, deslocamento = 0): { de: Date; ate: Date } {
  const h = diaLocal(agora)
  const diaSemana = new Date(Date.UTC(h.ano, h.mes - 1, h.dia)).getUTCDay() // 0 = domingo
  const domingo = h.dia - diaSemana + deslocamento * 7
  return {
    de: new Date(Date.UTC(h.ano, h.mes - 1, domingo, OFFSET_H)),
    ate: new Date(Date.UTC(h.ano, h.mes - 1, domingo + 7, OFFSET_H)),
  }
}

// dia local (00:00 a 00:00 seguinte) que contém `agora`
export function intervaloDoDia(agora: Date): { de: Date; ate: Date } {
  const h = diaLocal(agora)
  return { de: new Date(Date.UTC(h.ano, h.mes - 1, h.dia, OFFSET_H)), ate: new Date(Date.UTC(h.ano, h.mes - 1, h.dia + 1, OFFSET_H)) }
}

export function intervaloDoAno(ano: number): { de: Date; ate: Date } {
  return { de: new Date(Date.UTC(ano, 0, 1, OFFSET_H)), ate: new Date(Date.UTC(ano + 1, 0, 1, OFFSET_H)) }
}

export function rotuloMes(d: Date): string {
  const { ano, mes } = diaLocal(d)
  return `${String(mes).padStart(2, '0')}/${ano}`
}

export function rotuloDia(d: Date): string {
  const { mes, dia } = diaLocal(d)
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`
}

export function rotuloHora(d: Date): string {
  const l = new Date(d.getTime() - OFFSET_H * 3600_000)
  return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`
}

export function resolverData(d: DataLanc, ref: Date): Date | null {
  const h = diaLocal(ref)
  const hoje = meioDia(h.ano, h.mes, h.dia)
  if (d.tipo === 'relativa') return meioDia(h.ano, h.mes, h.dia - d.diasAtras)

  let r = meioDia(d.ano ?? h.ano, d.mes, d.dia)
  if (d.ano === undefined && r.getTime() > hoje.getTime()) r = meioDia(h.ano - 1, d.mes, d.dia) // sem ano e no futuro: ano anterior
  const existe = r.getUTCMonth() + 1 === d.mes // 31/04 e 29/02 fora de bissexto rolariam para o mês seguinte
  return existe && r.getTime() <= hoje.getTime() ? r : null
}
