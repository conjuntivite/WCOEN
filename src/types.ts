export type Natureza = 'despesa' | 'receita'
export type DataLanc = { tipo: 'relativa'; diasAtras: number } | { tipo: 'dia'; dia: number; mes: number; ano?: number }
// data = dia do lançamento (o balancete filtra por ela): a informada pelo usuário ou, sem ela, enviadoEm; enviadoEm = quando a mensagem foi enviada (ordena o desfazer)
export type NovoLancamento = { tipo: Natureza; conta: string; valor: number; remetente: string; msgId: string; data: Date; enviadoEm: Date; contaCorrenteId: string }
export type Lancamento = NovoLancamento & { desfeitoEm: Date | null }
export type Intervalo = { de: Date; ate: Date } | null   // null = tudo; `ate` é exclusivo
export type LinhaConta = { conta: string; total: number }
export type Balancete = { receitas: LinhaConta[]; despesas: LinhaConta[] } // cada lista em ordem decrescente de total
export type MesSerie = { ano: number; mes: number; receitas: number; despesas: number }
// `contaCorrenteId` opcional em extrato/balancete/serieMensal: sem ele, somam todas as contas correntes do cliente
export interface Repo {
  add(l: NovoLancamento): Promise<'ok' | 'duplicado'>
  desfazerUltimo(): Promise<Lancamento | null> // último por enviadoEm (desempate: inserção), ignora já desfeitos
  extrato(intervalo: { de: Date; ate: Date }, contaCorrenteId?: string): Promise<Lancamento[]> // sem desfeitos, data em [de, ate), ordem: data, enviadoEm, inserção
  balancete(intervalo: Intervalo, contaCorrenteId?: string): Promise<Balancete> // ignora desfeitos
  serieMensal(ate: Date, meses: number, contaCorrenteId?: string): Promise<MesSerie[]> // `meses` meses consecutivos terminando no mês local de `ate`, do mais antigo ao mais novo; meses sem lançamento vêm com 0; ignora desfeitos
}
export type Leitura = Pick<Repo, 'balancete' | 'serieMensal'> // o que o dashboard lê; sem escrita
export type ContaCorrente = { id: string; apelido: string; nome: string; saldoInicial: number; favorita: boolean; ativa: boolean }
export type ContaCorrenteComSaldo = ContaCorrente & { saldo: number }
// as contas correntes de UM cliente, como o Service as enxerga
export interface ContasDoCliente {
  favorita(): Promise<ContaCorrente> // cria a "Principal" se o cliente ainda não tem nenhuma
  porApelido(apelido: string): Promise<ContaCorrente | null> // ativa ou não: quem chama decide se ativa basta
  ativas(): Promise<ContaCorrenteComSaldo[]> // favorita primeiro, com saldo (mais caro: soma os lançamentos)
  quantasAtivas(): Promise<number> // só a contagem, barata: roda a cada lançamento
  porId(id: string): Promise<ContaCorrente | null> // ativa ou não
}
