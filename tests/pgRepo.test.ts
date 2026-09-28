import { afterAll, expect, it } from 'vitest'
import { Pool } from 'pg'
import { criarRepo } from '../src/repo'
import { repoContract } from './repo.contract'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen'
const limpador = new Pool({ connectionString: URL })
const fechar: Array<() => Promise<void>> = []

afterAll(async () => {
  await Promise.all(fechar.map((f) => f()))
  await limpador.end()
})

async function abrir() {
  await limpador.query('DROP TABLE IF EXISTS lancamentos')
  const pool = new Pool({ connectionString: URL })
  const { repoDe } = await criarRepo(pool)
  fechar.push(() => pool.end())
  return repoDe
}

repoContract(
  'PgRepo',
  async () => (await abrir())('conta-teste'),
  async () => {
    const repoDe = await abrir()
    return [repoDe('a'), repoDe('b')]
  },
)

it('add rejeita msgId repetido na mesma conta com "duplicado", sem estourar erro', async () => {
  const repoDe = await abrir()
  const repo = repoDe('c')
  const l = { tipo: 'despesa' as const, conta: 'x', valor: 100, remetente: 'u', msgId: 'm1', data: new Date(), enviadoEm: new Date() }
  expect(await repo.add(l)).toBe('ok')
  expect(await repo.add(l)).toBe('duplicado')
})

it('desfazerUltimo em concorrência: exatamente um sucede, outro retorna null', async () => {
  const repoDe = await abrir()
  const repo = repoDe('d')
  const l = { tipo: 'despesa' as const, conta: 'x', valor: 100, remetente: 'u', msgId: 'm2', data: new Date(), enviadoEm: new Date() }
  expect(await repo.add(l)).toBe('ok')
  // Simula corrida concorrente: ambas chamadas veem o mesmo lançamento como "último"
  const [r1, r2] = await Promise.all([repo.desfazerUltimo(), repo.desfazerUltimo()])
  // Exatamente um sucede e retorna o lançamento, o outro retorna null
  const resultados = [r1, r2]
  expect(resultados.filter((x) => x !== null)).toHaveLength(1)
  expect(resultados.filter((x) => x === null)).toHaveLength(1)
})
