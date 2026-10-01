import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Pool } from 'pg'
import type { Convites } from './convites'

const scrypt = promisify(scryptCb) as (senha: string, sal: Buffer, tamanho: number) => Promise<Buffer>
const TRINTA_DIAS_MS = 30 * 24 * 3600_000
const UMA_HORA_MS = 60 * 60_000
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const AVATAR_CORES = ['vermelho', 'laranja', 'amarelo', 'verde', 'azul', 'roxo', 'rosa', 'cinza'] as const
export const AVATAR_ICONES = ['inicial', 'pessoa', 'estrela', 'coracao', 'raio', 'folha', 'chama', 'foguete'] as const
export type Perfil = { nome?: string; cor?: string; icone?: string }

export type Papel = 'admin' | 'usuario'
// validadeAte: último dia de acesso, "AAAA-MM-DD" (só para usuário; vale o dia inteiro, no fuso de São Paulo)
export type Conta = { id: string; email: string; papel?: Papel; validadeAte?: string; grupoId?: string; grupoNome?: string; nome?: string; avatarCor?: string; avatarIcone?: string; criadaEm?: Date }
export type ErroCadastro = 'convite_invalido' | 'email_invalido' | 'senha_curta' | 'email_em_uso'
export type ContaResumo = { id: string; email: string; criadaEm: Date; grupoNome?: string; conectada: boolean; ativa: boolean; papel: Papel; validadeAte?: string; vencida: boolean }
type RowConta = {
  id: string
  email: string
  senha_hash: string
  criada_em: Date
  grupo_id: string | null
  grupo_nome: string | null
  conectada: boolean | null
  ativa: boolean
  papel: Papel
  validade_ate: string | null
  nome: string | null
  avatar_cor: string | null
  avatar_icone: string | null
}

const normalizar = (email: string) => email.trim().toLowerCase()
const paraConta = (d: RowConta): Conta => ({
  id: d.id,
  email: d.email,
  papel: d.papel,
  validadeAte: d.validade_ate ?? undefined,
  grupoId: d.grupo_id ?? undefined,
  grupoNome: d.grupo_nome ?? undefined,
  nome: d.nome ?? undefined,
  avatarCor: d.avatar_cor ?? undefined,
  avatarIcone: d.avatar_icone ?? undefined,
  criadaEm: d.criada_em,
})
const daLista = (lista: readonly string[], v?: string) => (v && lista.includes(v) ? v : null)
const sha256 = (s: string) => createHash('sha256').update(s).digest()
const igual = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b))

async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16)
  return `scrypt$${sal.toString('hex')}$${(await scrypt(senha, sal, 64)).toString('hex')}`
}

async function senhaConfere(senha: string, hash: string): Promise<boolean> {
  const [, sal, esperado] = hash.split('$')
  const obtido = await scrypt(senha, Buffer.from(sal, 'hex'), 64)
  const alvo = Buffer.from(esperado, 'hex')
  return obtido.length === alvo.length && timingSafeEqual(obtido, alvo)
}

// `convite` é o código mestre do .env (plano B); `convites`, os criados por um admin no painel (uso único cada)
// `agora` existe para os testes fixarem o relógio
export async function criarContas(pool: Pool, { convite, convites, agora = () => new Date() }: { convite: string; convites?: Convites; agora?: () => Date }) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contas (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      criada_em TIMESTAMPTZ NOT NULL,
      grupo_id TEXT,
      grupo_nome TEXT,
      conectada BOOLEAN
    );
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS ativa BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS nome TEXT;
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS avatar_cor TEXT;
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS avatar_icone TEXT;
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS papel TEXT NOT NULL DEFAULT 'usuario';
    ALTER TABLE contas ADD COLUMN IF NOT EXISTS validade_ate TEXT;
    -- ponytail: sem TTL automático (o Mongo tinha expireAfterSeconds); a validade já é checada em
    -- contaDoLogin, então linhas expiradas só ficam paradas na tabela. Nos pilotos (poucas contas) não
    -- importa; se crescer, apagar as expiradas de tempos em tempos (ex.: um DELETE agendado).
    CREATE TABLE IF NOT EXISTS logins (
      id TEXT PRIMARY KEY,
      conta_id TEXT NOT NULL,
      expira_em TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS redefinicoes_senha (
      id TEXT PRIMARY KEY,
      conta_id TEXT NOT NULL,
      expira_em TIMESTAMPTZ NOT NULL
    );
  `)
  const hashFalso = await hashSenha('senha-inexistente') // e-mail desconhecido gasta o mesmo tempo de um conhecido

  // "AAAA-MM-DD" de hoje em São Paulo: comparar texto ISO é comparar datas
  const hoje = () => agora().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const vencida = (d: RowConta) => d.validade_ate !== null && d.validade_ate < hoje()

  const porId = async (id: string): Promise<Conta | null> => {
    const r = await pool.query<RowConta>('SELECT * FROM contas WHERE id = $1', [id])
    const d = r.rows[0]
    return d && d.ativa && !vencida(d) ? paraConta(d) : null
  }

  return {
    porId,

    async cadastrar(email: string, senha: string, conviteInformado: string): Promise<{ ok: true; conta: Conta } | { ok: false; erro: ErroCadastro }> {
      const e = normalizar(email)
      const codigo = conviteInformado ?? ''
      const viaMestre = Boolean(convite) && igual(codigo, convite) // sem convite configurado no .env, o mestre nunca bate
      const viaConvites = !viaMestre && Boolean(convites) && (await convites!.existe(codigo)) // só espia; não consome antes de validar e-mail/senha
      if (!viaMestre && !viaConvites) return { ok: false, erro: 'convite_invalido' }
      if (!EMAIL.test(e)) return { ok: false, erro: 'email_invalido' }
      if (senha.length < 8) return { ok: false, erro: 'senha_curta' }
      const id = randomUUID()
      // consome só agora, logo antes de gravar: fecha a corrida de dois cadastros com o mesmo código dinâmico
      if (viaConvites && !(await convites!.consumir(codigo, id))) return { ok: false, erro: 'convite_invalido' }
      try {
        await pool.query('INSERT INTO contas (id, email, senha_hash, criada_em) VALUES ($1,$2,$3,now())', [id, e, await hashSenha(senha)])
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return { ok: false, erro: 'email_em_uso' }
        throw err
      }
      return { ok: true, conta: { id, email: e } }
    },

    // 'expirada' só aparece com a senha certa, para não revelar quais e-mails existem
    async verificar(email: string, senha: string): Promise<Conta | 'expirada' | null> {
      const r = await pool.query<RowConta>('SELECT * FROM contas WHERE email = $1', [normalizar(email)])
      const d = r.rows[0]
      const ok = await senhaConfere(senha, d?.senha_hash ?? hashFalso)
      if (!d || !ok || !d.ativa) return null
      return vencida(d) ? 'expirada' : paraConta(d)
    },

    async criarLogin(contaId: string): Promise<string> {
      const token = randomBytes(32).toString('base64url')
      await pool.query('INSERT INTO logins (id, conta_id, expira_em) VALUES ($1,$2,$3)', [
        sha256(token).toString('hex'),
        contaId,
        new Date(Date.now() + TRINTA_DIAS_MS),
      ])
      return token
    },

    async contaDoLogin(token: string): Promise<Conta | null> {
      const r = await pool.query<{ conta_id: string; expira_em: Date }>('SELECT conta_id, expira_em FROM logins WHERE id = $1', [sha256(token).toString('hex')])
      const l = r.rows[0]
      if (!l || l.expira_em.getTime() <= Date.now()) return null
      return porId(l.conta_id)
    },

    async encerrarLogin(token: string) {
      await pool.query('DELETE FROM logins WHERE id = $1', [sha256(token).toString('hex')])
    },

    async definirGrupo(contaId: string, grupoId: string, grupoNome: string) {
      await pool.query('UPDATE contas SET grupo_id = $2, grupo_nome = $3 WHERE id = $1', [contaId, grupoId, grupoNome])
    },

    async marcarConectada(contaId: string, conectada: boolean) {
      await pool.query('UPDATE contas SET conectada = $2 WHERE id = $1', [contaId, conectada])
    },

    async conectadas(): Promise<string[]> {
      const r = await pool.query<{ id: string }>('SELECT id FROM contas WHERE conectada = true AND ativa AND (validade_ate IS NULL OR validade_ate >= $1)', [hoje()])
      return r.rows.map((d) => d.id)
    },

    // contas que venceram mas ainda têm o WhatsApp conectado: quem chama desconecta
    async vencidasConectadas(): Promise<string[]> {
      const r = await pool.query<{ id: string }>('SELECT id FROM contas WHERE conectada = true AND ativa AND validade_ate < $1', [hoje()])
      return r.rows.map((d) => d.id)
    },

    async listarContas(): Promise<ContaResumo[]> {
      const r = await pool.query<RowConta>('SELECT * FROM contas ORDER BY criada_em DESC')
      return r.rows.map((d) => ({ id: d.id, email: d.email, criadaEm: d.criada_em, grupoNome: d.grupo_nome ?? undefined, conectada: Boolean(d.conectada), ativa: d.ativa, papel: d.papel, validadeAte: d.validade_ate ?? undefined, vencida: vencida(d) }))
    },

    // admin nunca tem validade; usuário sem data fica sem validade
    async definirPapel(contaId: string, papel: Papel, validadeAte?: string): Promise<'ok' | 'data_invalida'> {
      const data = papel === 'admin' || !validadeAte ? null : validadeAte
      if (data !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(data) || new Date(`${data}T00:00:00Z`).toJSON()?.slice(0, 10) !== data)) return 'data_invalida' // toJSON dá null em data impossível
      await pool.query('UPDATE contas SET papel = $2, validade_ate = $3 WHERE id = $1', [contaId, papel, data])
      return 'ok'
    },

    async definirAtiva(contaId: string, ativa: boolean): Promise<void> {
      await pool.query('UPDATE contas SET ativa = $2 WHERE id = $1', [contaId, ativa])
      if (!ativa) await pool.query('DELETE FROM logins WHERE conta_id = $1', [contaId])
    },

    async redefinirSenha(email: string, senha: string): Promise<boolean> {
      if (senha.length < 8) return false
      const e = normalizar(email)
      const r = await pool.query<{ id: string }>('UPDATE contas SET senha_hash = $2 WHERE email = $1 RETURNING id', [e, await hashSenha(senha)])
      if (!r.rows[0]) return false
      await pool.query('DELETE FROM logins WHERE conta_id = $1', [r.rows[0].id])
      return true
    },

    async porEmail(email: string): Promise<Conta | null> {
      const r = await pool.query<RowConta>('SELECT * FROM contas WHERE email = $1', [normalizar(email)])
      const d = r.rows[0]
      return d && d.ativa && !vencida(d) ? paraConta(d) : null
    },

    async definirPerfil(contaId: string, { nome, cor, icone }: Perfil): Promise<void> {
      await pool.query('UPDATE contas SET nome = $2, avatar_cor = $3, avatar_icone = $4 WHERE id = $1', [
        contaId,
        nome?.trim().slice(0, 40) || null,
        daLista(AVATAR_CORES, cor),
        daLista(AVATAR_ICONES, icone),
      ])
    },

    async trocarSenha(contaId: string, atual: string, nova: string): Promise<'ok' | 'senha_atual' | 'senha_curta'> {
      const r = await pool.query<{ senha_hash: string }>('SELECT senha_hash FROM contas WHERE id = $1', [contaId])
      if (!r.rows[0] || !(await senhaConfere(atual, r.rows[0].senha_hash))) return 'senha_atual'
      if (nova.length < 8) return 'senha_curta'
      await pool.query('UPDATE contas SET senha_hash = $2 WHERE id = $1', [contaId, await hashSenha(nova)])
      return 'ok'
    },

    async encerrarOutrosLogins(contaId: string, tokenAtual: string): Promise<void> {
      await pool.query('DELETE FROM logins WHERE conta_id = $1 AND id <> $2', [contaId, sha256(tokenAtual).toString('hex')])
    },

    async criarRedefinicao(contaId: string): Promise<string> {
      await pool.query('DELETE FROM redefinicoes_senha WHERE conta_id = $1', [contaId])
      const token = randomBytes(32).toString('base64url')
      await pool.query('INSERT INTO redefinicoes_senha (id, conta_id, expira_em) VALUES ($1,$2,$3)', [
        sha256(token).toString('hex'),
        contaId,
        new Date(Date.now() + UMA_HORA_MS),
      ])
      return token
    },

    async consumirRedefinicao(token: string): Promise<string | null> {
      const r = await pool.query<{ conta_id: string }>(
        'DELETE FROM redefinicoes_senha WHERE id = $1 AND expira_em > now() RETURNING conta_id',
        [sha256(token).toString('hex')],
      )
      return r.rows[0]?.conta_id ?? null
    },
  }
}

export type Contas = Awaited<ReturnType<typeof criarContas>>

// ponytail: em memória, as chaves só saem quando consultadas de novo. Basta para pilotos; com muito tráfego, expirar por varredura.
export function criarLimitador(max: number, janelaMs: number, agora: () => number = Date.now) {
  const falhas = new Map<string, number[]>()
  const recentes = (k: string) => {
    const lista = (falhas.get(k) ?? []).filter((t) => t > agora() - janelaMs)
    falhas.set(k, lista)
    return lista
  }
  return {
    bloqueado: (k: string) => recentes(k).length >= max,
    falhou: (k: string) => {
      recentes(k).push(agora())
    },
    limpar: (k: string) => {
      falhas.delete(k)
    },
  }
}
