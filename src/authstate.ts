import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { BufferJSON, initAuthCreds, proto, type AuthenticationState } from '@whiskeysockets/baileys'
import type { Collection } from 'mongodb'

export type DocAuth = { contaId: string; chave: string; valor: string }

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

export async function garantirIndiceAuth(col: Collection<DocAuth>) {
  await col.createIndex({ contaId: 1, chave: 1 }, { unique: true })
}

export async function apagarAuth(col: Collection<DocAuth>, contaId: string) {
  await col.deleteMany({ contaId })
}

// Mesmo contrato do useMultiFileAuthState do Baileys, mas no Mongo, por conta e criptografado.
export async function criarAuthState(col: Collection<DocAuth>, contaId: string, chave: Buffer) {
  const gravar = (k: string, v: unknown) =>
    col.updateOne({ contaId, chave: k }, { $set: { valor: cifrar(JSON.stringify(v, BufferJSON.replacer), chave) } }, { upsert: true })
  const remover = (k: string) => col.deleteOne({ contaId, chave: k })
  const ler = async (k: string) => {
    const d = await col.findOne({ contaId, chave: k })
    if (!d) return null
    try {
      return JSON.parse(decifrar(d.valor, chave), BufferJSON.reviver)
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
        const data: { [id: string]: any } = {}
        await Promise.all(
          ids.map(async (id) => {
            let v = await ler(`${type}-${id}`)
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v)
            data[id] = v
          }),
        )
        return data
      },
      set: async (data) => {
        const tarefas: Promise<unknown>[] = []
        for (const [categoria, itens] of Object.entries(data as Record<string, Record<string, unknown>>)) {
          for (const [id, v] of Object.entries(itens)) tarefas.push(v ? gravar(`${categoria}-${id}`, v) : remover(`${categoria}-${id}`))
        }
        await Promise.all(tarefas)
      },
    },
  }
  return { state, saveCreds: () => gravar('creds', creds) }
}
