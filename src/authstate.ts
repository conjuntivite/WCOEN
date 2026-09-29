import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from '@whiskeysockets/baileys'
import type { Pool } from 'pg'

// AES-256-GCM; o valor guardado é base64(iv[12] | tag[16] | texto cifrado)
export function cifrar(texto: string, chave: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chave, iv)
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64')
}

export function decifrar(valor: string, chave: Buffer): string {
  const b = Buffer.from(valor, 'base64')
  const d = createDecipheriv('aes-256-gcm', chave, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
}

export async function garantirTabelaAuth(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wa_auth (
      conta_id TEXT NOT NULL,
      chave TEXT NOT NULL,
      valor TEXT NOT NULL,
      PRIMARY KEY (conta_id, chave)
    )
  `)
}

export async function apagarAuth(pool: Pool, contaId: string) {
  await pool.query('DELETE FROM wa_auth WHERE conta_id = $1', [contaId])
}

// Mesmo contrato do useMultiFileAuthState do Baileys, mas no Postgres, por conta e criptografado.
export async function criarAuthState(pool: Pool, contaId: string, chave: Buffer) {
  const gravar = (k: string, v: unknown) =>
    pool.query(
      'INSERT INTO wa_auth (conta_id, chave, valor) VALUES ($1,$2,$3) ON CONFLICT (conta_id, chave) DO UPDATE SET valor = EXCLUDED.valor',
      [contaId, k, cifrar(JSON.stringify(v, BufferJSON.replacer), chave)],
    )
  const remover = (k: string) => pool.query('DELETE FROM wa_auth WHERE conta_id = $1 AND chave = $2', [contaId, k])
  const ler = async (k: string) => {
    const r = await pool.query<{ valor: string }>('SELECT valor FROM wa_auth WHERE conta_id = $1 AND chave = $2', [contaId, k])
    if (!r.rows[0]) return null
    try {
      return JSON.parse(decifrar(r.rows[0].valor, chave), BufferJSON.reviver)
    } catch {
      // nunca devolver null aqui: o Baileys criaria credenciais novas e sobrescreveria as gravadas
      throw new Error('CHAVE_CRIPTO não confere com a usada ao gravar as credenciais')
    }
  }

  const creds = (await ler('creds')) ?? initAuthCreds()
  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const t0 = Date.now()
        const data: { [id: string]: any } = {}
        await Promise.all(
          ids.map(async (id) => {
            let v = await ler(`${type}-${id}`)
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v)
            data[id] = v
          }),
        )
        console.log(`[DEBUG-tempo] conta ${contaId} auth.get ${type} x${ids.length}: ${Date.now() - t0} ms`)
        return data
      },
      set: async (data) => {
        const t0 = Date.now()
        const tarefas: Promise<unknown>[] = []
        for (const [categoria, itens] of Object.entries(data as Record<string, Record<string, unknown>>)) {
          for (const [id, v] of Object.entries(itens)) tarefas.push(v ? gravar(`${categoria}-${id}`, v) : remover(`${categoria}-${id}`))
        }
        await Promise.all(tarefas)
        console.log(`[DEBUG-tempo] conta ${contaId} auth.set x${tarefas.length}: ${Date.now() - t0} ms`)
      },
    },
  }
  return { state, saveCreds: () => gravar('creds', creds) }
}
