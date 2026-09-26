import { parse, type Comando, type Relatorio } from './parser'
import { formatBRL } from './money'
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
  '🔴 - 130 role na avenida → despesa',
  '📅 Data no fim (opcional): ontem · 15/09',
  '',
  '📊 *Consultar*',
  '• balancete mensal · semanal · anual → extrato + resumo',
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

  constructor(private repo: Repo, private agora: () => Date = () => new Date()) {}

  async handle(msg: Mensagem, opcoes: { recuperada?: boolean } = {}): Promise<Resposta | null> {
    if (this.tratadas.has(msg.msgId)) return null
    const cmd = parse(msg.texto)
    if (!cmd) return null
    if (opcoes.recuperada && (cmd.tipo === 'balancete' || cmd.tipo === 'uso' || cmd.tipo === 'ajuda')) return null
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
    }
  }

  private async balancete(rel: Relatorio): Promise<string> {
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

    const extrato = await this.repo.extrato(atual)
    const linhaTotais = (rotulo: string, receitas: number, despesas: number) =>
      `${rotulo} · 🟢 ${formatBRL(receitas)} · 🔴 ${formatBRL(despesas)} · 💰 ${formatBRL(receitas - despesas)}`

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
      linhas = extrato.map(
        (l) => `${rotuloDia(l.data)} ${rotuloHora(l.enviadoEm)} · ${l.tipo === 'receita' ? '🟢' : '🔴'} ${l.conta} — ${formatBRL(l.valor)}`,
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
}
