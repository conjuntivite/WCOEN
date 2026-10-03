import type { ContaCorrenteComSaldo, ContasDoCliente } from '../src/types'

export const PRINCIPAL: ContaCorrenteComSaldo = { id: 'cc1', apelido: 'principal', nome: 'Principal', saldoInicial: 0, saldo: 0, favorita: true, ativa: true }

// ContasDoCliente em memória para os testes do Service; o cálculo de saldo é testado em contasCorrentes.test.ts (Postgres)
export function contasEmMemoria(lista: ContaCorrenteComSaldo[] = [PRINCIPAL]): ContasDoCliente {
  const semSaldo = ({ saldo: _saldo, ...c }: ContaCorrenteComSaldo) => c
  return {
    favorita: async () => semSaldo(lista.find((c) => c.favorita)!),
    porApelido: async (apelido) => {
      const c = lista.find((x) => x.apelido === apelido)
      return c ? semSaldo(c) : null
    },
    ativas: async () => lista.filter((c) => c.ativa),
    quantasAtivas: async () => lista.filter((c) => c.ativa).length,
    nomes: async () => Object.fromEntries(lista.map((c) => [c.id, c.nome])),
    porId: async (id) => {
      const c = lista.find((x) => x.id === id)
      return c ? semSaldo(c) : null
    },
  }
}
