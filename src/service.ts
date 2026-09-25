import { parse, type Comando, type FiltroPedido, type Periodo } from './parser'
import { formatBRL, formatValor } from './money'
import { intervaloDaSemana, intervaloDoAno, intervaloDoMes, intervaloDoTrimestre, mesAtual, resolverData, rotuloDia, rotuloMes } from './period'
import type { Agrupador } from './agrupar'
import type { Filtro, Intervalo, LinhaConta, Natureza, Repo } from './types'

export type Mensagem = { msgId: string; remetente: string; texto: string; enviadoEm: Date }
export type Resposta = { texto: string; lancou: boolean }

export const ERRO_SALVAR = '⚠️ Não consegui salvar, tente de novo'
export const ERRO_GENERICO = '⚠️ Algo deu errado, tente de novo'
export const ERRO_DATA = '⚠️ Data inválida ou no futuro, não lancei'
export const IA_DESLIGADA = 'A IA não está configurada (defina OPENROUTER_API_KEY e OPENROUTER_MODEL no .env).'

const AJUDA = [
  'Comandos:',
  'mercado 45,90 → despesa',
  '+ salário 3000 → receita',
  'balancete | balancete tudo | balancete 08/2026',
  'balancete semana | semana passada | trimestre | ano | 2025',
  'balancete receitas | balancete despesas | balancete mercado (uma conta)',
  'balancete ia carro (agrupa contas por IA, se configurada)',
  'data opcional no fim: + plantão 450 ontem | mercado 45 15/09',
  'desfazer → desfaz o último lançamento',
].join('\n')

const soma = (linhas: LinhaConta[]) => linhas.reduce((s, l) => s + l.total, 0)

const rotuloDoFiltro = (f: FiltroPedido) =>
  f.tipo === 'conta'
    ? f.conta
    : f.tipo === 'tema'
      ? f.termo
      : f.tipo === 'contas'
        ? f.contas.join(', ')
        : f.natureza === 'receita'
          ? 'receitas'
          : 'despesas'

export class Service {
  // ponytail: dedupe só em memória; um restart entre a entrega e a reentrega pode desfazer duas vezes. Persistir o msgId se acontecer.
  private tratadas = new Set<string>()

  constructor(private repo: Repo, private agora: () => Date = () => new Date(), private agrupador?: Agrupador) {}

  async handle(msg: Mensagem, opcoes: { recuperada?: boolean } = {}): Promise<Resposta | null> {
    if (this.tratadas.has(msg.msgId)) return null
    const cmd = parse(msg.texto)
    if (!cmd) return null
    if (opcoes.recuperada && (cmd.tipo === 'balancete' || cmd.tipo === 'ajuda')) return null
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
        const rotulo = cmd.natureza === 'receita' ? 'Receita' : 'Despesa'
        const dia = cmd.data ? ` (${rotuloDia(data)})` : ''
        return { texto: `✅ ${rotulo}: ${cmd.conta} ${formatBRL(cmd.valor)}${dia}`, lancou: true }
      }
      case 'desfazer': {
        const l = await this.repo.desfazerUltimo()
        const texto = l ? `↩️ Desfeito: ${l.conta} ${formatBRL(l.valor)}` : 'Nada para desfazer.'
        return { texto, lancou: false }
      }
      case 'ajuda':
        return { texto: AJUDA, lancou: false }
      case 'balancete':
        return { texto: await this.balancete(cmd.periodo, cmd.filtro), lancou: false }
    }
  }

  private async balancete(p: Periodo, pedido?: FiltroPedido): Promise<string> {
    const agora = this.agora()
    let titulo = 'tudo'
    let intervalo: Intervalo = null
    if (p.tipo === 'semana') {
      intervalo = intervaloDaSemana(agora, p.passada)
      titulo = `semana ${rotuloDia(intervalo.de)} a ${rotuloDia(new Date(intervalo.ate.getTime() - 1))}`
    } else if (p.tipo === 'trimestre') {
      intervalo = intervaloDoTrimestre(agora)
      titulo = `trimestre ${rotuloMes(intervalo.de)} a ${rotuloMes(new Date(intervalo.ate.getTime() - 1))}`
    } else if (p.tipo === 'ano') {
      const ano = p.ano ?? mesAtual(agora).ano
      intervalo = intervaloDoAno(ano)
      titulo = String(ano)
    } else if (p.tipo !== 'tudo') {
      const { ano, mes } = p.tipo === 'mes' ? p : mesAtual(agora)
      titulo = `${String(mes).padStart(2, '0')}/${ano}`
      intervalo = intervaloDoMes(ano, mes)
    }

    const base = `📊 Balancete ${titulo}${pedido ? ` · ${rotuloDoFiltro(pedido)}` : ''}`

    // "ia <termo>": só aqui a IA é chamada, e só porque o usuário pediu. Ela escolhe, entre as contas do período, as relacionadas ao termo.
    let filtro: Filtro | undefined
    if (pedido?.tipo === 'tema') {
      if (!this.agrupador) return `${base}\n${IA_DESLIGADA}`
      const existentes = await this.repo.contas(intervalo)
      if (existentes.length === 0) return `${base}\nSem lançamentos no período.`
      let escolhidas: string[]
      try {
        escolhidas = await this.agrupador.agrupar(pedido.termo, existentes)
      } catch (err) {
        console.error('erro ao agrupar contas', err)
        return `${base}\nNão consegui agrupar agora, tente de novo.`
      }
      if (!escolhidas.length) return `${base}\nNão achei contas relacionadas a "${pedido.termo}" no período.`
      filtro = { tipo: 'contas', contas: escolhidas }
    } else {
      filtro = pedido
    }
    const cabecalho = pedido?.tipo === 'tema' ? `${base} (agrupado por IA)` : base

    const b = await this.repo.balancete(intervalo, filtro)
    if (!b.receitas.length && !b.despesas.length) return `${cabecalho}\nSem lançamentos no período.`

    // sem filtro: os dois blocos. Filtro por natureza: só aquele bloco. Filtro por conta(s): só os blocos que existem.
    const mostrar = (nat: Natureza, linhas: LinhaConta[]) =>
      filtro?.tipo === 'natureza' ? filtro.natureza === nat : filtro ? linhas.length > 0 : true
    const largura = Math.max(...[...b.receitas, ...b.despesas].map((l) => l.conta.length))
    const bloco = (nome: string, linhas: LinhaConta[]) => [
      `${nome}: ${formatBRL(soma(linhas))}`,
      // filtrando por uma conta, o total já é a resposta: sem listar a própria conta
      ...(filtro?.tipo === 'conta' ? [] : linhas.map((l) => `  ${l.conta.padEnd(largura)}  ${formatValor(l.total)}`)),
    ]
    const comReceitas = mostrar('receita', b.receitas)
    const comDespesas = mostrar('despesa', b.despesas)
    return [
      cabecalho,
      ...(comReceitas ? bloco('Receitas', b.receitas) : []),
      ...(comDespesas ? bloco('Despesas', b.despesas) : []),
      ...(comReceitas && comDespesas ? [`Saldo: ${formatBRL(soma(b.receitas) - soma(b.despesas))}`] : []),
    ].join('\n')
  }
}
