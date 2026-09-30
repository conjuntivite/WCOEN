import { intervaloDoMes, mesesTerminandoEm } from '../src/period'
import type { Balancete, Intervalo, Lancamento, LinhaConta, MesSerie, Natureza, NovoLancamento, Repo } from '../src/types'

export class MemoryRepo implements Repo {
  private itens: Lancamento[] = []

  async add(l: NovoLancamento) {
    if (this.itens.some((i) => i.msgId === l.msgId)) return 'duplicado' as const
    this.itens.push({ ...l, desfeitoEm: null })
    return 'ok' as const
  }

  async desfazerUltimo() {
    const vivos = this.itens
      .map((item, ordem) => ({ item, ordem }))
      .filter((x) => !x.item.desfeitoEm)
    if (!vivos.length) return null
    vivos.sort(
      (a, b) => b.item.enviadoEm.getTime() - a.item.enviadoEm.getTime() || b.ordem - a.ordem,
    )
    const alvo = vivos[0].item
    alvo.desfeitoEm = new Date()
    return { ...alvo }
  }

  async extrato(intervalo: { de: Date; ate: Date }) {
    return this.itens
      .map((item, ordem) => ({ item, ordem }))
      .filter((x) => !x.item.desfeitoEm && x.item.data.getTime() >= intervalo.de.getTime() && x.item.data.getTime() < intervalo.ate.getTime())
      .sort((a, b) => a.item.data.getTime() - b.item.data.getTime() || a.item.enviadoEm.getTime() - b.item.enviadoEm.getTime() || a.ordem - b.ordem)
      .map((x) => ({ ...x.item }))
  }

  async serieMensal(ate: Date, meses: number): Promise<MesSerie[]> {
    return mesesTerminandoEm(ate, meses).map(({ ano, mes }) => {
      const { de, ate: fim } = intervaloDoMes(ano, mes)
      const soma = (t: Natureza) =>
        this.itens
          .filter((i) => !i.desfeitoEm && i.tipo === t && i.data.getTime() >= de.getTime() && i.data.getTime() < fim.getTime())
          .reduce((s, i) => s + i.valor, 0)
      return { ano, mes, receitas: soma('receita'), despesas: soma('despesa') }
    })
  }

  async balancete(intervalo: Intervalo): Promise<Balancete> {
    const somas = { receita: new Map<string, number>(), despesa: new Map<string, number>() }
    for (const i of this.itens) {
      if (i.desfeitoEm) continue
      if (intervalo && (i.data.getTime() < intervalo.de.getTime() || i.data.getTime() >= intervalo.ate.getTime())) continue
      const m = somas[i.tipo]
      m.set(i.conta, (m.get(i.conta) ?? 0) + i.valor)
    }
    const linhas = (m: Map<string, number>): LinhaConta[] =>
      [...m].map(([conta, total]) => ({ conta, total })).sort((a, b) => b.total - a.total)
    return { receitas: linhas(somas.receita), despesas: linhas(somas.despesa) }
  }
}
