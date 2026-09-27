import { randomBytes } from 'node:crypto'
import { ObjectId, type Db } from 'mongodb'

export type Convite = { id: string; codigo: string; nota?: string; criadoEm: Date; usadoEm?: Date }
type DocConvite = { _id: ObjectId; codigo: string; nota?: string; criadoPor: string; criadoEm: Date; usadoEm?: Date; usadoPor?: string }

const paraConvite = (d: DocConvite): Convite => ({ id: d._id.toHexString(), codigo: d.codigo, nota: d.nota, criadoEm: d.criadoEm, usadoEm: d.usadoEm })
const gerarCodigo = () => randomBytes(5).toString('hex') // 10 caracteres, fácil de digitar/colar

// Convites criados por um admin no painel: cada um vale para um único cadastro. O código
// mestre do .env (CONVITE) continua funcionando à parte, como plano B — ver src/contas.ts.
export async function criarConvites(db: Db) {
  const col = db.collection<DocConvite>('convites')
  await col.createIndex({ codigo: 1 }, { unique: true })

  return {
    async criar(criadoPorContaId: string, nota?: string): Promise<Convite> {
      const notaLimpa = nota?.trim()
      const doc: DocConvite = { _id: new ObjectId(), codigo: gerarCodigo(), nota: notaLimpa || undefined, criadoPor: criadoPorContaId, criadoEm: new Date() }
      await col.insertOne(doc)
      return paraConvite(doc)
    },

    async listar(): Promise<Convite[]> {
      return (await col.find().sort({ criadoEm: -1 }).toArray()).map(paraConvite)
    },

    // "peek" sem mutar: usado para dar a mensagem de erro certa antes de validar e-mail/senha
    async existe(codigo: string): Promise<boolean> {
      return (await col.countDocuments({ codigo: codigo.trim(), usadoEm: { $exists: false } }, { limit: 1 })) > 0
    },

    // atômico: dois cadastros simultâneos com o mesmo código nunca passam os dois
    async consumir(codigo: string, contaId: string): Promise<boolean> {
      const r = await col.findOneAndUpdate({ codigo: codigo.trim(), usadoEm: { $exists: false } }, { $set: { usadoEm: new Date(), usadoPor: contaId } })
      return r !== null
    },

    // só remove convites ainda não usados (preserva o histórico dos já usados)
    async revogar(id: string): Promise<boolean> {
      if (!ObjectId.isValid(id)) return false
      const r = await col.deleteOne({ _id: new ObjectId(id), usadoEm: { $exists: false } })
      return r.deletedCount > 0
    },
  }
}

export type Convites = Awaited<ReturnType<typeof criarConvites>>
