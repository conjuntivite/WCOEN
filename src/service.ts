import { parse, type Comando, type Relatorio } from './parser'
import { formatBRL } from './money'
import * as ui from './presentation'
import type { Auditor, DadosAuditoria } from './auditar'
import { intervaloDaSemanaDomingo, intervaloDoAno, intervaloDoDia, intervaloDoMes, mesAtual, resolverData, rotuloDia, rotuloHora, rotuloMes } from './period'
import type { ContasDoCliente, Lancamento, LinhaConta, Natureza, Repo } from './types'

export type Mensagem = { msgId: string; remetente: string; texto: string; enviadoEm: Date }
export type Resposta = { texto: string; lancou: boolean }

export const POR_PAGINA = 20 // lançamentos por página do extrato

// transferência não é receita nem despesa: fica fora de totais e da auditoria
const soReceitaDespesa = (ls: Lancamento[]) => ls.filter((l): l is Lancamento & { tipo: Natureza } => l.tipo !== 'transferencia')
const somaTipo = (ls: Lancamento[], t: Natureza) => ls.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0)
const soma = (linhas: LinhaConta[]) => linhas.reduce((s, l) => s + l.total, 0)

export class Service {
  // ponytail: dedupe só em memória; um restart entre a entrega e a reentrega pode desfazer duas vezes. Persistir o msgId se acontecer.
  private tratadas = new Set<string>()

  constructor(
    private repo: Repo,
    private contasCC: ContasDoCliente,
    private agora: () => Date = () => new Date(),
    private auditor?: Auditor,
  ) {}

  async handle(msg: Mensagem, opcoes: { recuperada?: boolean } = {}): Promise<Resposta | null> {
    if (this.tratadas.has(msg.msgId)) return null
    const cmd = parse(msg.texto)
    if (!cmd) return null
    if (opcoes.recuperada && (cmd.tipo === 'balancete' || cmd.tipo === 'auditoria' || cmd.tipo === 'extrato' || cmd.tipo === 'uso' || cmd.tipo === 'ajuda' || cmd.tipo === 'contas')) return null
    try {
      const r = await this.executar(cmd, msg)
      this.tratadas.add(msg.msgId)
      return r
    } catch (err) {
      console.error('erro ao processar mensagem', msg.msgId, err)
      const gravando = cmd.tipo === 'lancamento' || cmd.tipo === 'desfazer'
      return { texto: gravando ? ui.ERRO_SALVAR : ui.ERRO_GENERICO, lancou: false }
    }
  }

  private async executar(cmd: Comando, msg: Mensagem): Promise<Resposta | null> {
    switch (cmd.tipo) {
      case 'lancamento': {
        const contaCorrente = cmd.contaCorrente ? await this.contasCC.porApelido(cmd.contaCorrente) : await this.contasCC.favorita()
        if (!contaCorrente || !contaCorrente.ativa) return { texto: ui.contaNaoEncontrada(cmd.contaCorrente ?? '', await this.contasCC.ativas(), true), lancou: false }
        // sem data informada pelo usuário, vale a data de envio da mensagem
        const data = cmd.data ? resolverData(cmd.data, msg.enviadoEm) : msg.enviadoEm
        if (!data) return { texto: ui.ERRO_DATA, lancou: false }
        const r = await this.repo.add({
          tipo: cmd.natureza,
          conta: cmd.conta,
          valor: cmd.valor,
          remetente: msg.remetente,
          msgId: msg.msgId,
          data,
          enviadoEm: msg.enviadoEm,
          contaCorrenteId: contaCorrente.id,
        })
        if (r === 'duplicado') return null
        const varias = (await this.contasCC.quantasAtivas()) >= 2 // com uma conta só, a confirmação fica como sempre foi
        return { texto: ui.lancamentoRegistrado({ natureza: cmd.natureza, conta: cmd.conta, valor: cmd.valor, dia: cmd.data ? data : undefined, contaCorrente: varias ? contaCorrente.nome : undefined }), lancou: true }
      }
      case 'desfazer': {
        const l = await this.repo.desfazerUltimo()
        // o último lançamento pode ser de qualquer conta: com 2+ contas ativas, diz de qual
        const conta = l && (await this.contasCC.quantasAtivas()) >= 2 ? await this.contasCC.porId(l.contaCorrenteId) : null
        return { texto: ui.desfeito(l, conta?.nome), lancou: false }
      }
      case 'contas':
        return { texto: ui.contas(await this.contasCC.ativas()), lancou: false }
      case 'transferencia': // provisório: implementado na Task 3
        return null
      case 'ajuda':
        return { texto: ui.AJUDA, lancou: false }
      case 'uso':
        return { texto: ui.USO[cmd.comando], lancou: false }
      case 'balancete':
        return { texto: await this.balancete(cmd.relatorio, cmd.contaCorrente), lancou: false }
      case 'auditoria':
        return { texto: await this.auditoria(cmd.relatorio), lancou: false }
      case 'extrato':
        return { texto: await this.extratoPagina(cmd.pagina, cmd.contaCorrente), lancou: false }
    }
  }

  // períodos do relatório, compartilhados por balancete e auditoria
  private periodos(rel: Relatorio) {
    const agora = this.agora()
    const { ano, mes } = mesAtual(agora)
    // atual = período da auditoria; janela = períodos do resumo (o atual primeiro, depois os anteriores)
    let titulo: string
    let atual: { de: Date; ate: Date }
    let janela: { rotulo: string; intervalo: { de: Date; ate: Date } }[]
    const n = (qtd: number) => Array.from({ length: qtd }, (_, i) => i)
    if (rel === 'mensal') {
      titulo = rotuloMes(agora)
      atual = intervaloDoMes(ano, mes)
      janela = n(12).map((i) => ({ rotulo: rotuloMes(intervaloDoMes(ano, mes - i).de), intervalo: intervaloDoMes(ano, mes - i) }))
    } else if (rel === 'semanal') {
      const rotulo = (i: number) => {
        const w = intervaloDaSemanaDomingo(agora, -i)
        return `${rotuloDia(w.de)} a ${rotuloDia(new Date(w.ate.getTime() - 1))}`
      }
      titulo = rotulo(0)
      atual = intervaloDaSemanaDomingo(agora)
      janela = n(4).map((i) => ({ rotulo: rotulo(i), intervalo: intervaloDaSemanaDomingo(agora, -i) }))
    } else {
      titulo = String(ano)
      atual = intervaloDoAno(ano)
      janela = n(5).map((i) => ({ rotulo: String(ano - i), intervalo: intervaloDoAno(ano - i) }))
    }

    return { titulo, atual, janela }
  }

  // `@apelido` de um relatório: o id/nome da conta, ou o texto de "não encontrada". Sem `@`, sem filtro. Desativadas ainda filtram.
  private async filtro(apelido?: string): Promise<{ id?: string; nome?: string } | { erro: string }> {
    if (!apelido) return {}
    const c = await this.contasCC.porApelido(apelido)
    if (!c) return { erro: ui.contaNaoEncontrada(apelido, await this.contasCC.ativas(), false) }
    return { id: c.id, nome: c.nome }
  }

  private async balancete(rel: 'hoje' | Relatorio, apelido?: string): Promise<string> {
    const f = await this.filtro(apelido)
    if ('erro' in f) return f.erro
    const agora = this.agora()
    if (rel === 'hoje') return this.balanceteDoDia(agora, f)

    // resumo: um bloco por período da janela (o atual primeiro); os sem movimento não aparecem
    const blocos: ui.BlocoPeriodo[] = []
    for (const { rotulo, intervalo } of this.periodos(rel).janela) {
      const b = await this.repo.balancete(intervalo, f.id)
      if (!b.receitas.length && !b.despesas.length) continue
      blocos.push({ rotulo, receitas: soma(b.receitas), despesas: soma(b.despesas) })
    }
    return ui.resumoPeriodos(rel, blocos, f.nome)
  }

  private async balanceteDoDia(agora: Date, f: { id?: string; nome?: string }): Promise<string> {
    const extrato = await this.repo.extrato(intervaloDoDia(agora), f.id)
    return ui.balanceteDoDia(agora, extrato, somaTipo(extrato, 'receita'), somaTipo(extrato, 'despesa'), f.nome)
  }

  // extrato completo, do mais recente ao mais antigo, POR_PAGINA lançamentos por página; os totais gerais só na página 1
  private async extratoPagina(pagina: number, apelido?: string): Promise<string> {
    const f = await this.filtro(apelido)
    if ('erro' in f) return f.erro
    const todos = (await this.repo.extrato({ de: new Date(0), ate: new Date('2100-01-01T00:00:00Z') }, f.id)).reverse()
    if (!todos.length) return ui.extratoVazio(f.nome)
    const total = Math.ceil(todos.length / POR_PAGINA)
    if (pagina > total) return ui.paginaInexistente(total)
    const itens = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA)
    return ui.extrato(pagina, total, itens, pagina === 1 ? { receitas: somaTipo(todos, 'receita'), despesas: somaTipo(todos, 'despesa') } : null, f.nome)
  }

  private async auditoria(rel: Relatorio): Promise<string> {
    const { titulo, atual, janela } = this.periodos(rel)
    const extrato = soReceitaDespesa(await this.repo.extrato(atual))
    if (!extrato.length) return ui.auditoriaVazia(rel, titulo)
    if (!this.auditor) return ui.auditoriaSemIA(rel, titulo)

    // tudo calculado aqui; a IA só recebe estes dados prontos e devolve texto
    const b = await this.repo.balancete(atual)
    const receitas = soma(b.receitas)
    const despesas = soma(b.despesas)
    const ranking = b.despesas.slice(0, 5).map((l) => ({ conta: l.conta, valor: formatBRL(l.total), percentual: Math.round((l.total * 100) / despesas) }))
    const ant = await this.repo.balancete(janela[1].intervalo) // janela[1] = período anterior
    const antReceitas = soma(ant.receitas)
    const antDespesas = soma(ant.despesas)
    const temAnterior = ant.receitas.length > 0 || ant.despesas.length > 0

    const dados: DadosAuditoria = {
      periodo: titulo,
      receitas: formatBRL(receitas),
      despesas: formatBRL(despesas),
      saldo: formatBRL(receitas - despesas),
      rankingDespesas: ranking,
      receitasPorConta: b.receitas.map((l) => ({ conta: l.conta, valor: formatBRL(l.total) })),
      ...(temAnterior && {
        comparacao: {
          periodo: janela[1].rotulo,
          receitas: formatBRL(antReceitas),
          despesas: formatBRL(antDespesas),
          saldo: formatBRL(antReceitas - antDespesas),
        },
      }),
      lancamentos: extrato.slice(-200).map((l) => ({
        data: `${rotuloDia(l.data)}/${rotuloMes(l.data).slice(3)}`,
        tipo: l.tipo,
        conta: l.conta,
        valor: formatBRL(l.valor),
      })),
    }

    let dicas: string[] = []
    try {
      dicas = await this.auditor.sugerir(dados)
    } catch (err) {
      console.error('auditoria: a IA falhou:', err instanceof Error ? err.message : err)
    }
    return ui.auditoria({
      rel,
      titulo,
      receitas,
      despesas,
      ranking: b.despesas.slice(0, 5).map((l, i) => ({ conta: l.conta, valor: l.total, percentual: ranking[i].percentual })),
      // variação só quando o período anterior tem despesas (senão a base é zero)
      ...(temAnterior && {
        comparacao: { periodo: janela[1].rotulo, receitas: antReceitas, despesas: antDespesas, variacaoDespesas: antDespesas > 0 ? Math.round(((despesas - antDespesas) * 100) / antDespesas) : null },
      }),
      dicas,
    })
  }
}
