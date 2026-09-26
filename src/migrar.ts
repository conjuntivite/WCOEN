import type { Db } from 'mongodb'

// Atribui a conta indicada aos lançamentos de antes do portal (sem contaId). Idempotente.
export async function migrarLegado(db: Db, email: string): Promise<number> {
  const conta = await db.collection('contas').findOne({ email: email.trim().toLowerCase() })
  if (!conta) throw new Error(`conta não encontrada: ${email}`)
  const r = await db.collection('lancamentos').updateMany({ contaId: { $exists: false } }, { $set: { contaId: conta._id.toHexString() } })
  return r.modifiedCount
}
