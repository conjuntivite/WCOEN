import { describe, it, expect } from 'vitest'
import { mesAtual, intervaloDoMes, intervaloDaSemana, intervaloDoTrimestre, intervaloDoAno, rotuloDia, rotuloMes, resolverData } from '../src/period'

describe('period (America/Sao_Paulo, -03:00)', () => {
  it('mesAtual usa o fuso local', () => {
    // 02:00Z de 1º/set = 23:00 de 31/ago em SP (Review Focus 5)
    expect(mesAtual(new Date('2026-09-01T02:00:00Z'))).toEqual({ ano: 2026, mes: 8 })
    expect(mesAtual(new Date('2026-09-01T03:00:00Z'))).toEqual({ ano: 2026, mes: 9 })
  })

  it('intervaloDoMes começa e termina às 03:00Z', () => {
    const { de, ate } = intervaloDoMes(2026, 9)
    expect(de.toISOString()).toBe('2026-09-01T03:00:00.000Z')
    expect(ate.toISOString()).toBe('2026-10-01T03:00:00.000Z')
  })

  it('dezembro vira o ano', () => {
    expect(intervaloDoMes(2026, 12).ate.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })
})

describe('semana (segunda a domingo)', () => {
  const terca = new Date('2026-09-15T12:00:00Z')

  it('semana atual e passada', () => {
    expect(intervaloDaSemana(terca)).toEqual({
      de: new Date('2026-09-14T03:00:00Z'),
      ate: new Date('2026-09-21T03:00:00Z'),
    })
    expect(intervaloDaSemana(terca, true)).toEqual({
      de: new Date('2026-09-07T03:00:00Z'),
      ate: new Date('2026-09-14T03:00:00Z'),
    })
  })

  it('domingo 23h ainda é a mesma semana; segunda 00h já é a próxima', () => {
    expect(intervaloDaSemana(new Date('2026-09-21T02:00:00Z')).de.toISOString()).toBe('2026-09-14T03:00:00.000Z')
    expect(intervaloDaSemana(new Date('2026-09-21T03:00:00Z')).de.toISOString()).toBe('2026-09-21T03:00:00.000Z')
  })

  it('atravessa a virada do mês', () => {
    // quarta 02/09/2026 → a segunda foi 31/08
    expect(intervaloDaSemana(new Date('2026-09-02T12:00:00Z')).de.toISOString()).toBe('2026-08-31T03:00:00.000Z')
  })
})

describe('rotuloDia', () => {
  it('usa o dia local', () => {
    expect(rotuloDia(new Date('2026-09-14T03:00:00Z'))).toBe('14/09')
    expect(rotuloDia(new Date('2026-09-14T02:59:00Z'))).toBe('13/09')
  })
})

describe('trimestre (3 meses fechados antes do mês atual)', () => {
  it('em 20/06 traz março, abril e maio', () => {
    const { de, ate } = intervaloDoTrimestre(new Date('2026-06-20T12:00:00Z'))
    expect(de.toISOString()).toBe('2026-03-01T03:00:00.000Z')
    expect(ate.toISOString()).toBe('2026-06-01T03:00:00.000Z')
  })

  it('em janeiro cruza o ano: out, nov e dez', () => {
    const { de, ate } = intervaloDoTrimestre(new Date('2026-01-10T12:00:00Z'))
    expect(de.toISOString()).toBe('2025-10-01T03:00:00.000Z')
    expect(ate.toISOString()).toBe('2026-01-01T03:00:00.000Z')
  })

  it('a virada do mês usa o fuso local', () => {
    // 31/05 às 23:59 em SP ainda é maio: o trimestre é fev–abr
    expect(intervaloDoTrimestre(new Date('2026-06-01T02:59:00Z')).de.toISOString()).toBe('2026-02-01T03:00:00.000Z')
    expect(intervaloDoTrimestre(new Date('2026-06-01T03:00:00Z')).de.toISOString()).toBe('2026-03-01T03:00:00.000Z')
  })
})

describe('ano do calendário', () => {
  it('intervaloDoAno cobre 01/01 até 01/01 seguinte', () => {
    const { de, ate } = intervaloDoAno(2026)
    expect(de.toISOString()).toBe('2026-01-01T03:00:00.000Z')
    expect(ate.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })
})

describe('rotuloMes', () => {
  it('usa o mês local', () => {
    expect(rotuloMes(new Date('2026-03-01T03:00:00Z'))).toBe('03/2026')
    expect(rotuloMes(new Date('2026-03-01T02:59:00Z'))).toBe('02/2026')
  })
})

describe('resolverData', () => {
  const ref = new Date('2026-09-10T15:00:00Z') // 10/09/2026 12:00 em SP
  const iso = (d: Date | null) => d?.toISOString() ?? null

  it('relativas contam a partir do dia de ref', () => {
    expect(iso(resolverData({ tipo: 'relativa', diasAtras: 0 }, ref))).toBe('2026-09-10T15:00:00.000Z')
    expect(iso(resolverData({ tipo: 'relativa', diasAtras: 1 }, ref))).toBe('2026-09-09T15:00:00.000Z')
    expect(iso(resolverData({ tipo: 'relativa', diasAtras: 10 }, ref))).toBe('2026-08-31T15:00:00.000Z')
  })

  it('23h em SP ainda é hoje', () => {
    const noite = new Date('2026-09-11T02:00:00Z') // 10/09 23:00 em SP
    expect(iso(resolverData({ tipo: 'relativa', diasAtras: 0 }, noite))).toBe('2026-09-10T15:00:00.000Z')
  })

  it('dia/mês sem ano usa o ano de ref; se cair no futuro, o ano anterior', () => {
    expect(iso(resolverData({ tipo: 'dia', dia: 5, mes: 9 }, ref))).toBe('2026-09-05T15:00:00.000Z')
    expect(iso(resolverData({ tipo: 'dia', dia: 25, mes: 9 }, ref))).toBe('2025-09-25T15:00:00.000Z')
  })

  it('ano explícito', () => {
    expect(iso(resolverData({ tipo: 'dia', dia: 31, mes: 8, ano: 2026 }, ref))).toBe('2026-08-31T15:00:00.000Z')
  })

  it('recusa futuro explícito e dia inexistente', () => {
    expect(resolverData({ tipo: 'dia', dia: 25, mes: 9, ano: 2026 }, ref)).toBeNull()
    expect(resolverData({ tipo: 'dia', dia: 29, mes: 2, ano: 2026 }, ref)).toBeNull()
    expect(resolverData({ tipo: 'dia', dia: 31, mes: 4 }, ref)).toBeNull()
  })
})
