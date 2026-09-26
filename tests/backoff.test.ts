import { describe, it, expect } from 'vitest'
import { atrasoReconexao } from '../src/backoff'

describe('atrasoReconexao', () => {
  it('cresce exponencialmente e trava em 60s', () => {
    expect(atrasoReconexao(0)).toBe(1000)
    expect(atrasoReconexao(1)).toBe(2000)
    expect(atrasoReconexao(3)).toBe(8000)
    expect(atrasoReconexao(6)).toBe(60_000)
    expect(atrasoReconexao(50)).toBe(60_000)
  })
})
