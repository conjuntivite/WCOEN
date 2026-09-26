import { describe, it, expect } from 'vitest'
import { BOAS_VINDAS, ERRO_DATA, ERRO_GENERICO, ERRO_SALVAR, auditoria, limpar, lancamentoRegistrado, recuperados, resumoPeriodos } from '../src/presentation'

describe('limpar (texto de usuário/IA na saída)', () => {
  it('troca * _ ~ ` por sósias, sem tocar no resto', () => {
    expect(limpar('mercado_*teste* ~x~ `y`')).toBe('mercado＿∗teste∗ ∼x∼ ˋyˋ')
    expect(limpar('café com pão 10')).toBe('café com pão 10')
  })
  it('a saída da despesa não tem marcadores soltos vindos da descrição', () => {
    const t = lancamentoRegistrado({ natureza: 'despesa', conta: '*a*_b_~c~`d`', valor: 100 })
    expect(t).toBe('🔴 *DESPESA REGISTRADA*\n\n📝 _∗a∗＿b＿∼c∼ˋdˋ_\n💰 *R$ 1,00*')
  })
})

describe('saldo: emoji pelo sinal', () => {
  const emojiDoSaldo = (receitas: number, despesas: number) =>
    resumoPeriodos('mensal', [{ rotulo: '09/2026', receitas, despesas }]).match(/(\S+) \*SALDO\*/)![1]
  it.each([
    ['positivo', 200, 100, '💚'],
    ['negativo', 100, 200, '⚠️'],
    ['zero', 100, 100, '⚪'],
  ])('%s', (_n, r, d, emoji) => expect(emojiDoSaldo(r, d)).toBe(emoji))
})

describe('auditoria: variação da comparação', () => {
  const base = { rel: 'mensal', titulo: '09/2026', receitas: 0, despesas: 100, ranking: [], dicas: [] }
  it('sem variação (base zero): nenhuma linha ▲/▼', () => {
    expect(auditoria({ ...base, comparacao: { periodo: '08/2026', receitas: 0, despesas: 0, variacaoDespesas: null } })).not.toMatch(/[▲▼▬]/)
  })
  it('variação zero', () => {
    expect(auditoria({ ...base, comparacao: { periodo: '08/2026', receitas: 0, despesas: 100, variacaoDespesas: 0 } })).toContain('_▬ 0%_')
  })
})

describe('erros', () => {
  it('mensagens padronizadas', () => {
    expect(ERRO_GENERICO).toBe('⚠️ *NÃO FOI POSSÍVEL CONCLUIR*\n\n_Tente novamente em alguns instantes._')
    expect(ERRO_SALVAR).toBe('⚠️ *NÃO FOI POSSÍVEL SALVAR*\n\n_Tente novamente._')
    expect(ERRO_DATA).toBe('📅 *DATA INVÁLIDA*\n\n_A data informada não existe ou está no futuro._\n\n_Nenhum lançamento foi registrado._')
  })
})

describe('mensagens do gerenciador de sessões', () => {
  it('boas-vindas', () => {
    expect(BOAS_VINDAS).toBe('✅ *CONECTADO*\n\n_Digite *ajuda* para ver os comandos._')
  })
  it('recuperados: singular e plural', () => {
    expect(recuperados(1)).toBe('📥 *LANÇAMENTOS RECUPERADOS*\n\n_1 lançamento feito enquanto eu estava offline._')
    expect(recuperados(3)).toBe('📥 *LANÇAMENTOS RECUPERADOS*\n\n_3 lançamentos feitos enquanto eu estava offline._')
  })
})
