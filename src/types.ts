export type Natureza = 'despesa' | 'receita'
export type DataLanc = { tipo: 'relativa'; diasAtras: number } | { tipo: 'dia'; dia: number; mes: number; ano?: number }
export type Filtro = { tipo: 'natureza'; natureza: Natureza } | { tipo: 'conta'; conta: string } | { tipo: 'contas'; contas: string[] }
// data = dia do lançamento (o balancete filtra por ela): a informada pelo usuário ou, sem ela, enviadoEm; enviadoEm = quando a mensagem foi enviada (ordena o desfazer)
export type NovoLancamento = { tipo: Natureza; conta: string; valor: number; remetente: string; msgId: string; data: Date; enviadoEm: Date }
export type Lancamento = NovoLancamento & { desfeitoEm: Date | null }
export type Intervalo = { de: Date; ate: Date } | null   // null = tudo; `ate` é exclusivo
export type LinhaConta = { conta: string; total: number }
export type Balancete = { receitas: LinhaConta[]; despesas: LinhaConta[] } // cada lista em ordem decrescente de total
export interface Repo {
  add(l: NovoLancamento): Promise<'ok' | 'duplicado'>
  desfazerUltimo(): Promise<Lancamento | null> // último por enviadoEm (desempate: inserção), ignora já desfeitos
  contas(intervalo: Intervalo): Promise<string[]> // nomes distintos de conta (sem desfeitos), em ordem crescente (`.sort()`)
  balancete(intervalo: Intervalo, filtro?: Filtro): Promise<Balancete> // ignora desfeitos; filtro restringe por natureza, por conta ou por várias contas
}
