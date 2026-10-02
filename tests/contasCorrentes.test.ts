import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { criarRepo } from '../src/repo'
import { criarContasCorrentes, type ContasCorrentes } from '../src/contasCorrentes'

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:wcoen@localhost:5432/wcoen_test'
const pool = new Pool({ connectionString: URL })
let cc: ContasCorrentes

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS contas_correntes')
  await pool.query('DROP TABLE IF EXISTS lancamentos')
  await criarRepo(pool)
  cc = await criarContasCorrentes(pool)
})
afterAll(() => pool.end())

const lancar = (contaId: string, contaCorrenteId: string | null, tipo: 'receita' | 'despesa', valor: number, desfeito = false) =>
  pool.query(
    `INSERT INTO lancamentos (conta_id, tipo, conta, valor, remetente, msg_id, data, enviado_em, desfeito_em, conta_corrente_id)
     VALUES ($1,$2,'x',$3,'u',gen_random_uuid()::text,now(),now(),$4,$5)`,
    [contaId, tipo, valor, desfeito ? new Date() : null, contaCorrenteId],
  )

describe('conta padrão', () => {
  it('o primeiro uso cria a "Principal" favorita; chamar de novo não duplica', async () => {
    const a = await cc.doCliente('c1').favorita()
    expect(a).toMatchObject({ apelido: 'principal', nome: 'Principal', favorita: true, ativa: true, saldoInicial: 0 })
    expect((await cc.doCliente('c1').favorita()).id).toBe(a.id)
    expect(await cc.listar('c1')).toHaveLength(1)
  })

  it('duas chamadas simultâneas criam uma só', async () => {
    await Promise.all([cc.doCliente('c2').favorita(), cc.doCliente('c2').favorita()])
    expect(await cc.listar('c2')).toHaveLength(1)
  })

  it('cada cliente tem a sua', async () => {
    const a = await cc.doCliente('c1').favorita()
    const b = await cc.doCliente('c2').favorita()
    expect(a.id).not.toBe(b.id)
  })
})

describe('migração', () => {
  it('cliente com lançamentos antigos ganha a Principal e os lançamentos apontam para ela; rodar de novo não duplica', async () => {
    await lancar('antigo', null, 'despesa', 500)
    await lancar('antigo', null, 'receita', 900)
    await criarContasCorrentes(pool)
    await criarContasCorrentes(pool)
    const lista = await cc.listar('antigo')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ apelido: 'principal', favorita: true, saldo: 400 })
    const r = await pool.query('SELECT count(*)::int AS n FROM lancamentos WHERE conta_id = $1 AND conta_corrente_id IS NULL', ['antigo'])
    expect(r.rows[0].n).toBe(0)
  })
})

describe('criar', () => {
  it('cria conta não favorita, com apelido minúsculo e saldo inicial', async () => {
    const r = await cc.criar('c1', { apelido: ' Nubank ', nome: 'Nubank', saldoInicial: 150000 })
    expect(r.ok && r.conta).toMatchObject({ apelido: 'nubank', nome: 'Nubank', saldoInicial: 150000, favorita: false, ativa: true })
    const lista = await cc.listar('c1')
    expect(lista.map((c) => c.apelido)).toEqual(['principal', 'nubank']) // favorita primeiro
  })

  it('recusa apelido inválido, repetido (mesmo cliente) e nome vazio ou longo; outro cliente pode repetir', async () => {
    expect(await cc.criar('c1', { apelido: 'com espaço', nome: 'X', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_invalido' })
    expect(await cc.criar('c1', { apelido: 'a'.repeat(21), nome: 'X', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_invalido' })
    expect(await cc.criar('c1', { apelido: 'ação', nome: 'X', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_invalido' })
    expect(await cc.criar('c1', { apelido: 'nubank', nome: '  ', saldoInicial: 0 })).toEqual({ ok: false, erro: 'nome_invalido' })
    expect(await cc.criar('c1', { apelido: 'nubank', nome: 'x'.repeat(41), saldoInicial: 0 })).toEqual({ ok: false, erro: 'nome_invalido' })
    expect((await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })).ok).toBe(true)
    expect(await cc.criar('c1', { apelido: 'NUBANK', nome: 'Outro', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_em_uso' })
    expect(await cc.criar('c1', { apelido: 'principal', nome: 'Outro', saldoInicial: 0 })).toEqual({ ok: false, erro: 'apelido_em_uso' })
    expect((await cc.criar('c2', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })).ok).toBe(true)
  })
})

describe('porApelido e ativas', () => {
  it('porApelido acha ativa e desativada, e só do próprio cliente', async () => {
    await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = (await cc.doCliente('c1').porApelido('nubank'))!.id
    await cc.definirAtiva('c1', id, false)
    expect(await cc.doCliente('c1').porApelido('nubank')).toMatchObject({ ativa: false })
    expect(await cc.doCliente('c2').porApelido('nubank')).toBeNull()
    expect(await cc.doCliente('c1').porApelido('nao-existe')).toBeNull()
  })

  it('ativas lista só as ativas, favorita primeiro', async () => {
    await cc.criar('c1', { apelido: 'b', nome: 'B', saldoInicial: 0 })
    await cc.criar('c1', { apelido: 'a', nome: 'A', saldoInicial: 0 })
    const b = (await cc.doCliente('c1').porApelido('b'))!
    await cc.definirAtiva('c1', b.id, false)
    expect((await cc.doCliente('c1').ativas()).map((c) => c.apelido)).toEqual(['principal', 'a'])
  })
})

describe('saldo', () => {
  it('saldo inicial + receitas − despesas da conta, sem desfeitos, de todas as datas', async () => {
    const principal = await cc.doCliente('c1').favorita()
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 10000 })
    const nubank = r.ok ? r.conta : null
    await lancar('c1', nubank!.id, 'receita', 5000)
    await lancar('c1', nubank!.id, 'despesa', 2000)
    await lancar('c1', nubank!.id, 'despesa', 999, true) // desfeito: não conta
    await lancar('c1', principal.id, 'despesa', 300)
    const lista = await cc.listar('c1')
    expect(lista.find((c) => c.apelido === 'nubank')!.saldo).toBe(13000)
    expect(lista.find((c) => c.apelido === 'principal')!.saldo).toBe(-300)
  })
})

describe('editar', () => {
  it('muda nome e saldo inicial, nunca o apelido, e só do próprio cliente', async () => {
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = r.ok ? r.conta.id : ''
    expect(await cc.editar('c1', id, { nome: 'Nu Conta', saldoInicial: -5000 })).toBe('ok')
    expect(await cc.doCliente('c1').porApelido('nubank')).toMatchObject({ nome: 'Nu Conta', saldoInicial: -5000 })
    expect(await cc.editar('c1', id, { nome: '  ', saldoInicial: 0 })).toBe('nome_invalido')
    expect(await cc.editar('c2', id, { nome: 'Invasor', saldoInicial: 0 })).toBe('nao_encontrada')
    expect(await cc.doCliente('c1').porApelido('nubank')).toMatchObject({ nome: 'Nu Conta' })
  })
})

describe('favoritar e desativar', () => {
  it('favoritar troca a favorita na mesma operação; sempre uma só', async () => {
    const principal = await cc.doCliente('c1').favorita()
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const nubank = r.ok ? r.conta : null
    expect(await cc.favoritar('c1', nubank!.id)).toBe('ok')
    expect((await cc.doCliente('c1').favorita()).id).toBe(nubank!.id)
    expect((await cc.listar('c1')).filter((c) => c.favorita)).toHaveLength(1)
    expect(await cc.doCliente('c1').porApelido('principal')).toMatchObject({ id: principal.id, favorita: false })
  })

  it('não favorita conta desativada nem conta de outro cliente', async () => {
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = r.ok ? r.conta.id : ''
    await cc.definirAtiva('c1', id, false)
    expect(await cc.favoritar('c1', id)).toBe('inativa')
    expect(await cc.favoritar('c2', id)).toBe('nao_encontrada')
  })

  it('não desativa a favorita; desativa e reativa as outras', async () => {
    const principal = await cc.doCliente('c1').favorita()
    expect(await cc.definirAtiva('c1', principal.id, false)).toBe('favorita')
    const r = await cc.criar('c1', { apelido: 'nubank', nome: 'Nubank', saldoInicial: 0 })
    const id = r.ok ? r.conta.id : ''
    expect(await cc.definirAtiva('c1', id, false)).toBe('ok')
    expect(await cc.definirAtiva('c1', id, true)).toBe('ok')
    expect(await cc.definirAtiva('c2', id, false)).toBe('nao_encontrada')
  })
})
