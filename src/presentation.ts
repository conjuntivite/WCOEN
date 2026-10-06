// Apresentação das mensagens do WhatsApp: só monta texto, nunca calcula nem acessa dados.
// Sintaxe nativa: *negrito*, _itálico_, `código`. Padrão: emoji + TÍTULO em negrito, período em itálico, valores em negrito.
import { formatBRL } from './money'
import { rotuloDia, rotuloHora, rotuloMes } from './period'
import type { ContaCorrenteComSaldo, Lancamento, Natureza, TipoLancamento } from './types'

// --- helpers -------------------------------------------------------------

const SEP = '──────────────'
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

const bold = (s: string) => `*${s}*`
const italic = (s: string) => `_${s}_`
const cmd = (s: string) => `\`${s}\`` // ponytail: crase simples é "código inline" nos apps atuais; se o cliente antigo não renderizar, trocar por bold aqui
const secoes = (...blocos: string[]) => blocos.join(`\n\n${SEP}\n\n`)
const cabecalho = (emoji: string, titulo: string, sub?: string) => `${emoji} ${bold(titulo)}${sub ? `\n${italic(sub)}` : ''}`
const erro = (emoji: string, titulo: string, ...linhas: string[]) => [`${emoji} ${bold(titulo)}`, ...linhas.map(italic)].join('\n\n')

// O WhatsApp não tem escape para * _ ~ `: texto do usuário/IA trocaria a formatação. Só na saída, troca por sósias visuais.
const SOSIAS: Record<string, string> = { '*': '∗', _: '＿', '~': '∼', '`': 'ˋ' }
export const limpar = (s: string) => s.replace(/[*_~`]/g, (c) => SOSIAS[c])

// "09/2026" -> "Setembro/2026"; rótulos de semana e ano passam direto
const rotuloBonito = (r: string) => r.replace(/^(\d{2})\/(\d{4})$/, (_, m, a) => `${MESES[Number(m) - 1]}/${a}`)
export const dataCompleta = (d: Date) => `${rotuloDia(d)}/${rotuloMes(d).slice(3)}`
const saldoEmoji = (n: number) => (n > 0 ? '💚' : n < 0 ? '⚠️' : '⚪')
const linhaValor = (emoji: string, rotulo: string, valor: string) => `${emoji} ${rotulo}\n${bold(valor)}`

// saldo real das contas (o que está no banco), destacado no topo dos relatórios; não confundir com o RESULTADO do período
const blocoSaldo = (saldo: number) => linhaValor('🏦', bold('SALDO ATUAL'), formatBRL(saldo))

// receitas / despesas / resultado do período, um valor por linha; o resultado ganha o emoji do sinal
const totais = (receitas: number, despesas: number) =>
  [
    linhaValor('🟢', 'Receitas', formatBRL(receitas)),
    linhaValor('🔴', 'Despesas', formatBRL(despesas)),
    linhaValor(saldoEmoji(receitas - despesas), bold('RESULTADO'), formatBRL(receitas - despesas)),
  ].join('\n\n')

const sinal = (t: TipoLancamento, valor: number) => bold(t === 'transferencia' ? formatBRL(valor) : `${t === 'receita' ? '+' : '−'} ${formatBRL(valor)}`)
const icone = (t: TipoLancamento) => (t === 'receita' ? '🟢' : t === 'despesa' ? '🔴' : '🔁')

// descrição da linha do extrato: a do lançamento ou, na transferência, "origem → destino" (nomes por id; desativadas incluídas)
const descricaoDe = (l: Lancamento, nomes: Record<string, string>) =>
  l.tipo === 'transferencia' ? `${limpar(nomes[l.contaCorrenteId] ?? '?')} → ${limpar(nomes[l.contaDestinoId ?? ''] ?? '?')}` : limpar(l.conta)

// --- lançamentos ---------------------------------------------------------

export function lancamentoRegistrado(l: { natureza: Natureza; conta: string; valor: number; dia?: Date; contaCorrente?: string }): string {
  const linhas = [`📝 ${italic(limpar(l.conta))}`, `💰 ${bold(formatBRL(l.valor))}`, ...(l.dia ? [`📅 ${italic(rotuloDia(l.dia))}`] : []), ...(l.contaCorrente ? [`🏦 ${italic(limpar(l.contaCorrente))}`] : [])]
  return `${cabecalho(icone(l.natureza), l.natureza === 'receita' ? 'RECEITA REGISTRADA' : 'DESPESA REGISTRADA')}\n\n${linhas.join('\n')}`
}

export function transferenciaRegistrada(t: { origem: string; destino: string; valor: number; dia?: Date }): string {
  const linhas = [`🏦 ${italic(`${limpar(t.origem)} → ${limpar(t.destino)}`)}`, `💰 ${bold(formatBRL(t.valor))}`, ...(t.dia ? [`📅 ${italic(rotuloDia(t.dia))}`] : [])]
  return `${cabecalho('🔁', 'TRANSFERÊNCIA REGISTRADA')}\n\n${linhas.join('\n')}`
}

export const transferenciaDesfeita = (t: { origem: string; destino: string; valor: number }) =>
  `${cabecalho('↩️', 'TRANSFERÊNCIA DESFEITA')}\n\n🏦 ${italic(`${limpar(t.origem)} → ${limpar(t.destino)}`)}\n💰 ${bold(formatBRL(t.valor))}`

export const TRANSFERENCIA_MESMA_CONTA = erro('🔁', 'MESMA CONTA', 'Origem e destino são a mesma conta.', 'Nenhuma transferência foi registrada.')

export function desfeito(l: { conta: string; valor: number } | null, contaCorrente?: string): string {
  if (!l) return erro('↩️', 'NADA PARA DESFAZER', 'Não há lançamentos para desfazer.')
  return `${cabecalho('↩️', 'LANÇAMENTO DESFEITO')}\n\n📝 ${italic(limpar(l.conta))}\n💰 ${bold(formatBRL(l.valor))}${contaCorrente ? `\n🏦 ${italic(limpar(contaCorrente))}` : ''}`
}

// --- relatórios ----------------------------------------------------------

// relatório filtrado por conta corrente: o nome da conta vai no subtítulo
const comFiltro = (sub: string | undefined, filtro?: string) => (filtro ? [sub, limpar(filtro)].filter(Boolean).join(' · ') : sub)

// `saldo`: saldo atual das contas do relatório (undefined = desconhecido, ex.: conta desativada)
export function balanceteDoDia(agora: Date, itens: Lancamento[], receitas: number, despesas: number, filtro?: string, nomes: Record<string, string> = {}, saldo?: number): string {
  const cab = cabecalho('📊', 'BALANCETE DO DIA', comFiltro(dataCompleta(agora), filtro))
  const saldoAtual = saldo === undefined ? [] : [blocoSaldo(saldo)]
  if (!itens.length) return secoes(cab, ...saldoAtual, italic('Nenhum lançamento registrado hoje.'))
  const linhas = itens.map((l) => `🕐 ${bold(rotuloHora(l.enviadoEm))}\n${icone(l.tipo)} ${descricaoDe(l, nomes)}\n${sinal(l.tipo, l.valor)}`)
  return secoes(cab, ...saldoAtual, linhas.join('\n\n'), totais(receitas, despesas))
}

export type BlocoPeriodo = { rotulo: string; receitas: number; despesas: number }

export function resumoPeriodos(rel: string, blocos: BlocoPeriodo[], filtro?: string, saldo?: number): string {
  const cab = cabecalho('📊', `BALANCETE ${rel.toUpperCase()}`, comFiltro(undefined, filtro))
  const saldoAtual = saldo === undefined ? [] : [blocoSaldo(saldo)]
  if (!blocos.length) return secoes(cab, ...saldoAtual, italic('Nenhum lançamento no período.'))
  return secoes(cab, ...saldoAtual, ...blocos.map((b) => `📅 ${bold(rotuloBonito(b.rotulo))}\n\n${totais(b.receitas, b.despesas)}`))
}

// `saldos`: saldo atual e saldo ao fim de cada dia (chave = dataCompleta); ausente quando a conta filtrada está desativada
export type SaldosExtrato = { agora: Date; atual: number; porDia: Record<string, number> }

export function extrato(pagina: number, total: number, itens: Lancamento[], geral: { receitas: number; despesas: number } | null, filtro?: string, nomes: Record<string, string> = {}, saldos?: SaldosExtrato, apelidos: Record<string, string> = {}): string {
  // itens já vêm do mais recente ao mais antigo: um bloco por dia, com o saldo ao fim dele
  const dias: { chave: string; itens: Lancamento[] }[] = []
  for (const l of itens) {
    const chave = dataCompleta(l.data)
    if (dias.at(-1)?.chave !== chave) dias.push({ chave, itens: [] })
    dias.at(-1)!.itens.push(l)
  }
  const blocos = dias.map((d) => {
    const titulo = `📅 ${bold(`${saldos && d.chave === dataCompleta(saldos.agora) ? 'HOJE · ' : ''}${d.chave.slice(0, 5)}`)}`
    const saldoDoDia = saldos ? `\n💰 Saldo do dia: ${bold(formatBRL(saldos.porDia[d.chave]))}` : ''
    // `apelidos` vazio = não mostra a conta; a transferência já diz origem → destino
    const conta = (l: Lancamento) => (l.tipo !== 'transferencia' && apelidos[l.contaCorrenteId] ? `\n🏦 ${italic(`@${limpar(apelidos[l.contaCorrenteId])}`)}` : '')
    const linhas = d.itens.map((l) => `🕐 ${bold(rotuloHora(l.enviadoEm))}\n${icone(l.tipo)} ${italic(descricaoDe(l, nomes))}\n${sinal(l.tipo, l.valor)}${conta(l)}`)
    return `${titulo}${saldoDoDia}\n\n${linhas.join('\n\n')}`
  })
  const rodape = pagina < total ? `➡️ ${italic(`Digite ${bold(`/extrato ${pagina + 1}`)} para continuar.`)}` : total > 1 ? `✅ ${italic('Fim do extrato.')}` : ''
  return secoes(
    cabecalho('📒', 'EXTRATO', comFiltro(`Página ${pagina} de ${total}`, filtro)),
    ...(saldos ? [blocoSaldo(saldos.atual)] : []),
    ...(geral ? [totais(geral.receitas, geral.despesas)] : []),
    ...blocos,
    ...(rodape ? [rodape] : []),
  )
}

export const extratoVazio = (filtro?: string) => `${cabecalho('📒', 'EXTRATO', comFiltro(undefined, filtro))}\n\n${italic('Nenhum lançamento encontrado.')}`

export const paginaInexistente = (total: number) =>
  erro('📒', 'PÁGINA INEXISTENTE', `O extrato tem só ${total} ${total === 1 ? 'página' : 'páginas'}.`) + `\n\n➡️ ${italic(`Digite ${bold('/extrato')} para começar.`)}`

// --- auditoria -----------------------------------------------------------

export type DadosMensagemAuditoria = {
  rel: string
  titulo: string
  receitas: number
  despesas: number
  ranking: { conta: string; valor: number; percentual: number }[]
  comparacao?: { periodo: string; receitas: number; despesas: number; variacaoDespesas: number | null } // variação em %, null se a base é zero
  dicas: string[]
}

const cabAuditoria = (rel: string, titulo: string) => cabecalho('🔎', 'AUDITORIA FINANCEIRA', `${rel[0].toUpperCase()}${rel.slice(1)} · ${rotuloBonito(titulo)}`)
const POSICAO = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣']

export const IA_DESLIGADA = `${italic('A IA não está configurada.')}\n\nDefina ${cmd('OPENROUTER_API_KEY')} e ${cmd('OPENROUTER_MODEL')} no ${cmd('.env')}.`
export const auditoriaVazia = (rel: string, titulo: string) => `${cabAuditoria(rel, titulo)}\n\n${italic('Nenhum lançamento no período.')}`
export const auditoriaSemIA = (rel: string, titulo: string) => `${cabAuditoria(rel, titulo)}\n\n${IA_DESLIGADA}`

const variacao = (pct: number | null) => (pct === null ? '' : `\n${italic(pct > 0 ? `▲ ${pct}%` : pct < 0 ? `▼ ${-pct}%` : '▬ 0%')}`)
const de = (antes: number, agora: number) => `${italic(`${formatBRL(antes)} →`)} ${bold(formatBRL(agora))}`

export function auditoria(a: DadosMensagemAuditoria): string {
  const blocos = [cabAuditoria(a.rel, a.titulo), `📊 ${bold('RESUMO')}\n\n${totais(a.receitas, a.despesas)}`]
  if (a.ranking.length) {
    const itens = a.ranking.map((r, i) => `${POSICAO[i]} ${limpar(r.conta)}\n${bold(formatBRL(r.valor))} · ${italic(`${r.percentual}%`)}`)
    blocos.push(`🏆 ${bold('MAIORES GASTOS')}\n\n${itens.join('\n\n')}`)
  }
  if (a.comparacao) {
    const c = a.comparacao
    blocos.push(
      [
        cabecalho('📈', 'COMPARAÇÃO', `Período anterior: ${rotuloBonito(c.periodo)}`),
        `🟢 Receitas\n${de(c.receitas, a.receitas)}`,
        `🔴 Despesas\n${de(c.despesas, a.despesas)}${variacao(c.variacaoDespesas)}`,
        `💰 Saldo\n${de(c.receitas - c.despesas, a.receitas - a.despesas)}`,
      ].join('\n\n'),
    )
  }
  const dicas = a.dicas.length ? a.dicas.map((d) => `• ${italic(limpar(d))}`).join('\n\n') : italic('Indisponível no momento. Tente novamente mais tarde.')
  blocos.push(`💡 ${bold('ANÁLISE DA IA')}\n\n${dicas}`)
  return secoes(...blocos)
}

// --- ajuda, uso e erros --------------------------------------------------

export const AJUDA = [
  cabecalho('🤖', 'WCOEN', 'Seu controle financeiro pelo WhatsApp'),
  [
    `💸 ${bold('LANÇAMENTOS')}`,
    `🔴 Despesa\n${cmd('/d mercado 45,90')}`,
    `🟢 Receita\n${cmd('/r plantão 70')}`,
    `📅 Data opcional\n${cmd('/d mercado 45 ontem')}\n${cmd('/d mercado 45 15/09')}`,
    `🏦 Outra conta (a favorita é a padrão)\n${cmd('/d mercado 45 @nubank')}`,
    `📸 Foto de nota (IA lê, você confirma)\n${cmd('/nota')} ${italic('na legenda da foto')}\n${italic('confira a prévia e envie')} ${cmd('/ok')}`,
  ].join('\n\n'),
  [
    `📊 ${bold('RELATÓRIOS')}`,
    `${cmd('/balancete')}\n${italic('movimentações de hoje')}`,
    `${cmd('/balancete mensal')}\n${italic('resumo dos últimos meses')}`,
    `${cmd('/balancete semanal')}\n${cmd('/balancete anual')}`,
  ].join('\n\n'),
  [`🔎 ${bold('AUDITORIA')}`, `${cmd('/auditoria mensal')}\n${cmd('/auditoria semanal')}\n${cmd('/auditoria anual')}\n${italic('ranking e análise da IA')}`].join('\n\n'),
  [`📒 ${bold('EXTRATO')}`, `${cmd('/extrato')}\n${italic('do mais recente ao mais antigo')}\n\n${cmd('/extrato 2')}\n${italic('próxima página')}`].join('\n\n'),
  [`🏦 ${bold('CONTAS')}`, `${cmd('/contas')} ou ${cmd('/saldo')}\n${italic('contas e saldos')}\n\n${cmd('/balancete @conta')}\n${cmd('/extrato @conta')}\n${italic('relatório de uma conta só')}`, `🔁 Transferência entre contas\n${cmd('/t 500 @nubank @itau')}\n${italic('sai do primeiro, vai para o segundo')}\n${cmd('/t 500 @itau')}\n${italic('sai da conta favorita')}`].join('\n\n'),
  [`↩️ ${bold('CORREÇÃO')}`, `${cmd('/desfazer')}\n${italic('desfaz o último lançamento')}`].join('\n\n'),
].join(`\n\n${SEP}\n\n`)

export const BOAS_VINDAS = `${cabecalho('✅', 'CONECTADO')}\n\n${italic(`Digite ${bold('/ajuda')} para ver os comandos.`)}`

export const recuperados = (n: number) =>
  `${cabecalho('📥', 'LANÇAMENTOS RECUPERADOS')}\n\n${italic(`${n} lançamento${n > 1 ? 's' : ''} feito${n > 1 ? 's' : ''} enquanto eu estava offline.`)}`

const uso = (...comandos: string[]) => `${erro('⚠️', 'COMANDO INCOMPLETO', 'Use um destes:')}\n\n${comandos.map((c) => `👉 ${cmd(c)}`).join('\n')}`
export const USO = {
  balancete: uso('/balancete', '/balancete mensal', '/balancete semanal', '/balancete anual', '/balancete @conta'),
  auditoria: uso('/auditoria mensal', '/auditoria semanal', '/auditoria anual'),
  extrato: uso('/extrato', '/extrato 2', '/extrato @conta'),
  despesa: uso('/d mercado 45,90', '/d mercado 45,90 ontem', '/d mercado 45,90 15/09', '/d mercado 45,90 @conta'),
  receita: uso('/r plantão 70', '/r plantão 70 ontem', '/r plantão 70 15/09', '/r plantão 70 @conta'),
  transferencia: uso('/t 500 @nubank @itau', '/t 500 @itau', '/t 500 @nubank @itau ontem'),
}

// `gravando`: o comando era um lançamento (nada foi gravado) ou só o filtro de um relatório
export const contaNaoEncontrada = (apelido: string, ativas: ContaCorrenteComSaldo[], gravando: boolean) =>
  `${erro('🏦', 'CONTA NÃO ENCONTRADA', `A conta @${limpar(apelido)} não existe ou está desativada.`, ...(gravando ? ['Nenhum lançamento foi registrado.'] : []))}\n\n${ativas.map((c) => `👉 ${cmd(`@${c.apelido}`)} · ${limpar(c.nome)}`).join('\n')}`

export function contas(lista: ContaCorrenteComSaldo[], saldoTotal: number): string {
  const itens = lista.map((c) => `${c.favorita ? '⭐ ' : ''}${bold(limpar(c.nome))}\n${cmd(`@${c.apelido}`)}\n${bold(formatBRL(c.saldo))}`)
  return secoes(cabecalho('🏦', 'CONTAS CORRENTES'), linhaValor('💰', bold('SALDO TOTAL'), formatBRL(saldoTotal)), ...itens)
}

export const ERRO_GENERICO = erro('⚠️', 'NÃO FOI POSSÍVEL CONCLUIR', 'Tente novamente em alguns instantes.')
export const ERRO_SALVAR = erro('⚠️', 'NÃO FOI POSSÍVEL SALVAR', 'Tente novamente.')
export const ERRO_DATA = erro('📅', 'DATA INVÁLIDA', 'A data informada não existe ou está no futuro.', 'Nenhum lançamento foi registrado.')
