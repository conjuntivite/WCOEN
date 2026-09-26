import { describe, it, expect } from 'vitest'
import type { NovoLancamento, Repo } from '../src/types'

let n = 0
const novo = (o: Partial<NovoLancamento> = {}): NovoLancamento => ({
  tipo: 'despesa',
  conta: 'mercado',
  valor: 1000,
  remetente: 'u@s.whatsapp.net',
  msgId: `m${++n}`,
  data: new Date('2026-09-10T12:00:00Z'),
  enviadoEm: new Date('2026-09-10T12:00:00Z'),
  ...o,
})

export function repoContract(nome: string, criar: () => Promise<Repo>, criarPar?: () => Promise<[Repo, Repo]>) {
  describe(`Repo (${nome})`, () => {
    it('add grava uma vez e rejeita msgId repetido', async () => {
      const repo = await criar()
      const l = novo()
      expect(await repo.add(l)).toBe('ok')
      expect(await repo.add(l)).toBe('duplicado')
      expect((await repo.balancete(null)).despesas).toEqual([{ conta: 'mercado', total: 1000 }])
    })

    it('balancete soma por tipo e conta, do maior para o menor', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'mercado', valor: 1000 }))
      await repo.add(novo({ conta: 'mercado', valor: 500 }))
      await repo.add(novo({ conta: 'luz', valor: 3000 }))
      await repo.add(novo({ tipo: 'receita', conta: 'salario', valor: 200000 }))
      expect(await repo.balancete(null)).toEqual({
        receitas: [{ conta: 'salario', total: 200000 }],
        despesas: [{ conta: 'luz', total: 3000 }, { conta: 'mercado', total: 1500 }],
      })
    })

    it('balancete filtra por intervalo [de, ate)', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'antes', data: new Date('2026-09-01T02:59:59Z') }))
      await repo.add(novo({ conta: 'dentro', data: new Date('2026-09-01T03:00:00Z') }))
      await repo.add(novo({ conta: 'depois', data: new Date('2026-10-01T03:00:00Z') }))
      const b = await repo.balancete({
        de: new Date('2026-09-01T03:00:00Z'),
        ate: new Date('2026-10-01T03:00:00Z'),
      })
      expect(b.despesas.map((l) => l.conta)).toEqual(['dentro'])
    })

    it('desfazerUltimo segue enviadoEm (mensagem recuperada mais antiga é a última desfeita)', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'a', valor: 100, enviadoEm: new Date('2026-09-10T10:00:00Z') }))
      await repo.add(novo({ conta: 'b', valor: 200, enviadoEm: new Date('2026-09-10T11:00:00Z') }))
      await repo.add(novo({ conta: 'c', valor: 300, enviadoEm: new Date('2026-09-10T09:00:00Z') })) // inserido por último, mas enviado antes

      expect((await repo.desfazerUltimo())?.conta).toBe('b')
      expect((await repo.balancete(null)).despesas.map((l) => l.conta).sort()).toEqual(['a', 'c']) // desfeito some do balancete
      expect((await repo.desfazerUltimo())?.conta).toBe('a')
      expect((await repo.desfazerUltimo())?.conta).toBe('c')
      expect(await repo.desfazerUltimo()).toBeNull()
      expect(await repo.balancete(null)).toEqual({ receitas: [], despesas: [] })
    })

    it('desfazerUltimo desfaz o último enviado, mesmo com data de lançamento retroativa', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'hoje', enviadoEm: new Date('2026-09-10T11:00:00Z'), data: new Date('2026-09-10T15:00:00Z') }))
      await repo.add(novo({ conta: 'retroativo', enviadoEm: new Date('2026-09-10T12:00:00Z'), data: new Date('2026-09-01T15:00:00Z') }))
      expect((await repo.desfazerUltimo())?.conta).toBe('retroativo')
    })

    it('extrato ordena por data, depois enviadoEm, depois inserção', async () => {
      const repo = await criar()
      const de = new Date('2026-09-01T03:00:00Z')
      const ate = new Date('2026-10-01T03:00:00Z')
      await repo.add(novo({ conta: 'c', data: new Date('2026-09-12T15:00:00Z'), enviadoEm: new Date('2026-09-12T15:00:00Z') }))
      await repo.add(novo({ conta: 'b2', data: new Date('2026-09-10T15:00:00Z'), enviadoEm: new Date('2026-09-10T16:00:00Z') }))
      await repo.add(novo({ conta: 'b1', data: new Date('2026-09-10T15:00:00Z'), enviadoEm: new Date('2026-09-10T14:00:00Z') }))
      await repo.add(novo({ conta: 'a1', data: new Date('2026-09-05T15:00:00Z'), enviadoEm: new Date('2026-09-05T15:00:00Z') }))
      await repo.add(novo({ conta: 'a2', data: new Date('2026-09-05T15:00:00Z'), enviadoEm: new Date('2026-09-05T15:00:00Z') }))
      expect((await repo.extrato({ de, ate })).map((l) => l.conta)).toEqual(['a1', 'a2', 'b1', 'b2', 'c'])
    })

    it('extrato respeita [de, ate)', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'antes', data: new Date('2026-09-01T02:59:59Z') }))
      await repo.add(novo({ conta: 'em-de', data: new Date('2026-09-01T03:00:00Z') }))
      await repo.add(novo({ conta: 'em-ate', data: new Date('2026-10-01T03:00:00Z') }))
      const r = await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })
      expect(r.map((l) => l.conta)).toEqual(['em-de'])
    })

    it('extrato exclui desfeitos', async () => {
      const repo = await criar()
      await repo.add(novo({ conta: 'fica', enviadoEm: new Date('2026-09-10T10:00:00Z') }))
      await repo.add(novo({ conta: 'some', enviadoEm: new Date('2026-09-10T11:00:00Z') }))
      await repo.desfazerUltimo()
      const r = await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })
      expect(r.map((l) => l.conta)).toEqual(['fica'])
    })

    it('extrato devolve receitas e despesas com os campos preservados', async () => {
      const repo = await criar()
      const d = new Date('2026-09-10T15:00:00Z')
      const e1 = new Date('2026-09-10T15:30:00Z')
      const e2 = new Date('2026-09-10T16:45:00Z')
      await repo.add(novo({ tipo: 'receita', conta: 'salario', valor: 200000, data: d, enviadoEm: e1 }))
      await repo.add(novo({ tipo: 'despesa', conta: 'luz', valor: 3050, data: d, enviadoEm: e2 }))
      const r = await repo.extrato({ de: new Date('2026-09-01T03:00:00Z'), ate: new Date('2026-10-01T03:00:00Z') })
      expect(r.map((l) => [l.tipo, l.conta, l.valor, l.data, l.enviadoEm])).toEqual([
        ['receita', 'salario', 200000, d, e1],
        ['despesa', 'luz', 3050, d, e2],
      ])
    })

    if (criarPar) {
      it('isola contas: mesmo msgId em duas contas não colide e nada se mistura', async () => {
        const [a, b] = await criarPar()
        const l = novo({ msgId: 'mesmo' })
        expect(await a.add(l)).toBe('ok')
        expect(await b.add(l)).toBe('ok')
        await b.add(novo({ conta: 'luz', valor: 700 }))

        expect((await a.balancete(null)).despesas).toEqual([{ conta: 'mercado', total: 1000 }])
        expect((await b.balancete(null)).despesas).toEqual([{ conta: 'mercado', total: 1000 }, { conta: 'luz', total: 700 }])

        expect((await a.desfazerUltimo())?.conta).toBe('mercado')
        expect(await a.extrato({ de: new Date(0), ate: new Date('2100-01-01') })).toHaveLength(0)
        expect(await b.extrato({ de: new Date(0), ate: new Date('2100-01-01') })).toHaveLength(2) // b intacta
      })
    }
  })
}
