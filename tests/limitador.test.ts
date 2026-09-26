import { describe, expect, it } from 'vitest'
import { criarLimitador } from '../src/contas'

describe('criarLimitador', () => {
  it('bloqueia depois de N falhas na janela e libera com o tempo', () => {
    let t = 0
    const l = criarLimitador(3, 1000, () => t)
    for (let i = 0; i < 3; i++) l.falhou('k')
    expect(l.bloqueado('k')).toBe(true)
    expect(l.bloqueado('outra')).toBe(false)
    t = 1001
    expect(l.bloqueado('k')).toBe(false)
  })

  it('limpar zera a contagem', () => {
    const l = criarLimitador(1, 1000)
    l.falhou('k')
    expect(l.bloqueado('k')).toBe(true)
    l.limpar('k')
    expect(l.bloqueado('k')).toBe(false)
  })
})
