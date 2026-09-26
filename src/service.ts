import { parse, type Comando, type Relatorio } from './parser'
import { formatBRL } from './money'
import type { Auditor, DadosAuditoria } from './auditar'
import { intervaloDaSemanaDomingo, intervaloDoAno, intervaloDoMes, mesAtual, resolverData, rotuloDia, rotuloHora, rotuloMes } from './period'
import type { LinhaConta, Natureza, Repo } from './types'

export type Mensagem = { msgId: string; remetente: string; texto: string; enviadoEm: Date }
export type Resposta = { texto: string; lancou: boolean }

export const ERRO_SALVAR = '⚠️ Não consegui salvar, tente de novo'
export const ERRO_GENERICO = '⚠️ Algo deu errado, tente de novo'
export const ERRO_DATA = '⚠️ Data inválida ou no futuro, não lancei'
export const IA_DESLIGADA = 'A IA não está configurada (defina OPENROUTER_API_KEY e OPENROUTER_MODEL no .env).'

const AJUDA = [
  '🤖 *WCOEN · Comandos*',
  '',
  '💸 *Lançar*',
  '🔴 mercado 45,90 → despesa',
  '🟢 + 70 plantão → receita',
  '🟢 salário 3000 → receita também (salário, plantão, venda, freela…)',
  '🔴 - 130 role na avenida → despesa',
  '📅 Data no fim (opcional): ontem · 15/09',
  '',
  '📊 *Consultar*',
  '• balancete mensal · semanal · anual → extrato + resumo',
  '• auditoria mensal · semanal · anual → ranking e dicas da IA',
  '',
  '↩️ *Corrigir*',
  '• desfazer → desfaz o último lançamento',
].join('\n')

const USO = {
  balancete: '⚠️ Use *balancete mensal*, *balancete semanal* ou *balancete anual*.',
  auditoria: '⚠️ Use *auditoria mensal*, *auditoria semanal* ou *auditoria anual*.',
}

const soma = (linhas: LinhaConta[]) => linhas.reduce((s, l) => s + l.total, 0)

export class Service {
  // ponytail: dedupe só em memória; um restart entre a entrega e a reentrega pode desfazer duas vezes. Persistir o msgId se acontecer.
  private tratadas = new Set<string>()

  constructor(
    private repo: Repo,
    private agora: () => Date = () => new Date(),
    private auditor?: Auditor,
  ) {}

  async handle(msg: Mensagem, opcoes: { recuperada?: boolean } = {}): Promise<Resposta | null> {
    if (this.tratadas.has(msg.msgId)) return null
    const cmd = parse(msg.texto)
    if (!cmd) return null
    if (opcoes.recuperada && (cmd.tipo === 'balancete' || cmd.tipo === 'auditoria' || cmd.tipo === 'uso' || cmd.tipo === 'ajuda')) return null
    try {
      const r = await this.executar(cmd, msg)
      this.tratadas.add(msg.msgId)
      return r
    } catch (err) {
      console.error('erro ao processar mensagem', msg.msgId, err)
      const gravando = cmd.tipo === 'lancamento' || cmd.tipo === 'desfazer'
      return { texto: gravando ? ERRO_SALVAR : ERRO_GENERICO, lancou: false }
    }
  }

  private async executar(cmd: Comando, msg: Mensagem): Promise<Resposta | null> {
    switch (cmd.tipo) {
      case 'lancamento': {
        // sem data informada pelo usuário, vale a data de envio da mensagem
        const data = cmd.data ? resolverData(cmd.data, msg.enviadoEm) : msg.enviadoEm
        if (!data) return { texto: ERRO_DATA, lancou: false }
        const r = await this.repo.add({
          tipo: cmd.natureza,
          conta: cmd.conta,
          valor: cmd.valor,
          remetente: msg.remetente,
          msgId: msg.msgId,
          data,
          enviadoEm: msg.enviadoEm,
        })
        if (r === 'duplicado') return null
        const rotulo = cmd.natureza === 'receita' ? '🟢 *Receita*' : '🔴 *Despesa*'
        const dia = cmd.data ? ` · 📅 ${rotuloDia(data)}` : ''
        return { texto: `${rotulo} · ${cmd.conta} · ${formatBRL(cmd.valor)}${dia}`, lancou: true }
      }
      case 'desfazer': {
        const l = await this.repo.desfazerUltimo()
        const texto = l ? `↩️ *Desfeito* · ${l.conta} · ${formatBRL(l.valor)}` : '↩️ Nada para desfazer.'
        return { texto, lancou: false }
      }
      case 'ajuda':
        return { texto: AJUDA, lancou: false }
      case 'uso':
        return { texto: USO[cmd.comando], lancou: false }
      case 'balancete':
        return { texto: await this.balancete(cmd.relatorio), lancou: false }
      case 'auditoria':
        return { texto: await this.auditoria(cmd.relatorio), lancou: false }
    }
  }

  // períodos do relatório, compartilhados por balancete e auditoria
  private periodos(rel: Relatorio) {
    const agora = this.agora()
    const { ano, mes } = mesAtual(agora)
    // atual = período do extrato; janela = períodos do resumo (o atual primeiro, depois os anteriores)
    let titulo: string
    let atual: { de: Date; ate: Date }
    let janela: { rotulo: string; intervalo: { de: Date; ate: Date } }[]
    let cabExtrato = '📅 *Extrato*'
    let vazio: string
    let cabResumo: string
    const n = (qtd: number) => Array.from({ length: qtd }, (_, i) => i)
    if (rel === 'mensal') {
      titulo = rotuloMes(agora)
      atual = intervaloDoMes(ano, mes)
      janela = n(12).map((i) => ({ rotulo: rotuloMes(intervaloDoMes(ano, mes - i).de), intervalo: intervaloDoMes(ano, mes - i) }))
      vazio = 'Sem lançamentos neste mês.'
      cabResumo = '📈 *Últimos meses* (até 12, só com movimento)'
    } else if (rel === 'semanal') {
      const rotulo = (i: number) => {
        const w = intervaloDaSemanaDomingo(agora, -i)
        return `${rotuloDia(w.de)} a ${rotuloDia(new Date(w.ate.getTime() - 1))}`
      }
      titulo = rotulo(0)
      atual = intervaloDaSemanaDomingo(agora)
      janela = n(4).map((i) => ({ rotulo: rotulo(i), intervalo: intervaloDaSemanaDomingo(agora, -i) }))
      vazio = 'Sem lançamentos nesta semana.'
      cabResumo = '📈 *Últimas 4 semanas* (só com movimento)'
    } else {
      titulo = String(ano)
      atual = intervaloDoAno(ano)
      janela = n(5).map((i) => ({ rotulo: String(ano - i), intervalo: intervaloDoAno(ano - i) }))
      cabExtrato = '📅 *Por mês*'
      vazio = 'Sem lançamentos neste ano.'
      cabResumo = '📈 *Últimos 5 anos* (só com movimento)'
    }

    return { titulo, atual, janela, cabExtrato, vazio, cabResumo }
  }

  private async balancete(rel: Relatorio): Promise<string> {
    const { titulo, atual, janela, cabExtrato, vazio, cabResumo } = this.periodos(rel)
    const extrato = await this.repo.extrato(atual)
    // resumo: valores sem "R$" (o total acima já mostra a moeda) e um item por linha, com o ícone junto do valor
    // (numa linha só, o celular quebrava logo depois do ícone e o valor descia sozinho)
    const sem = (centavos: number) => formatBRL(centavos).replace('R$ ', '')
    const linhaTotais = (rotulo: string, receitas: number, despesas: number) =>
      `*${rotulo}*\n🟢 ${sem(receitas)}\n🔴 ${sem(despesas)}\n💰 ${sem(receitas - despesas)}`

    // extrato: uma linha por lançamento; no anual, uma linha por mês com movimento (ordem crescente)
    let linhas: string[]
    if (rel === 'anual') {
      const meses = new Map<string, [number, number]>()
      for (const l of extrato) {
        const m = meses.get(rotuloMes(l.data)) ?? [0, 0]
        m[l.tipo === 'receita' ? 0 : 1] += l.valor
        meses.set(rotuloMes(l.data), m)
      }
      linhas = [...meses].map(([rotulo, [r, d]]) => linhaTotais(rotulo, r, d))
    } else {
      // duas linhas por lançamento: dia e hora em cima; valor e descrição embaixo
      linhas = extrato.map(
        (l) => `*${rotuloDia(l.data)} às ${rotuloHora(l.enviadoEm)}*\n${l.tipo === 'receita' ? '🟢' : '🔴'} ${formatBRL(l.valor)} · ${l.conta}`,
      )
    }

    const blocos = [`📊 *Balancete ${rel} · ${titulo}*`, [cabExtrato, ...(extrato.length ? linhas : [vazio])].join('\n')]
    if (extrato.length) {
      const total = (t: Natureza) => extrato.filter((l) => l.tipo === t).reduce((s, l) => s + l.valor, 0)
      blocos.push(
        [
          `🟢 *Receitas* — ${formatBRL(total('receita'))}`,
          `🔴 *Despesas* — ${formatBRL(total('despesa'))}`,
          `💰 *Saldo: ${formatBRL(total('receita') - total('despesa'))}*`,
        ].join('\n'),
      )
    }

    // resumo: um balancete por período da janela; os sem movimento não aparecem
    const resumo: string[] = []
    for (const { rotulo, intervalo } of janela) {
      const b = await this.repo.balancete(intervalo)
      if (b.receitas.length || b.despesas.length) resumo.push(linhaTotais(rotulo, soma(b.receitas), soma(b.despesas)))
    }
    if (resumo.length) blocos.push([cabResumo, ...resumo].join('\n'))
    return blocos.join('\n\n')
  }
  private async auditoria(rel: Relatorio): Promise<string> {
    const { titulo, atual, janela } = this.periodos(rel)
    const cab = `🔎 *Auditoria ${rel} · ${titulo}*`
    const extrato = await this.repo.extrato(atual)
    if (!extrato.length) return `${cab}\n\nSem lançamentos no período.`
    if (!this.auditor) return `${cab}\n\n${IA_DESLIGADA}`

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

    const blocos = [
      cab,
      [
        `🟢 *Receitas* — ${dados.receitas}`,
        `🔴 *Despesas* — ${dados.despesas}`,
        `💰 *Saldo: ${dados.saldo}*`,
      ].join('\n'),
    ]
    if (ranking.length) {
      blocos.push(['🏆 *Maiores gastos*', ...ranking.map((r, i) => `${i + 1}. ${r.conta} — ${r.valor} (${r.percentual}%)`)].join('\n'))
    }
    if (dados.comparacao) {
      // variação só quando o período anterior tem despesas (senão a base é zero)
      const variacao = antDespesas > 0 ? Math.round(((despesas - antDespesas) * 100) / antDespesas) : null
      const pct = variacao === null ? '' : ` (${variacao > 0 ? '+' : ''}${variacao}%)`
      const c = dados.comparacao
      blocos.push(
        [
          `📉 *Comparado a ${c.periodo}*`,
          `🟢 Receitas: ${c.receitas} → ${dados.receitas}`,
          `🔴 Despesas: ${c.despesas} → ${dados.despesas}${pct}`,
          `💰 Saldo: ${c.saldo} → ${dados.saldo}`,
        ].join('\n'),
      )
    }

    let dicas: string[] = []
    try {
      dicas = await this.auditor.sugerir(dados)
    } catch (err) {
      console.error('auditoria: a IA falhou:', err instanceof Error ? err.message : err)
    }
    blocos.push(['💡 *Sugestões da IA*', ...(dicas.length ? dicas.map((d) => `• ${d}`) : ['Indisponível agora, tente de novo.'])].join('\n'))
    return blocos.join('\n\n')
  }
}
