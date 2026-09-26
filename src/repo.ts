import { MongoClient, type Collection, type Filter } from 'mongodb'
import type { Balancete, Intervalo, Lancamento, Natureza, NovoLancamento, Repo } from './types'

type Doc = Lancamento & { contaId: string }

class MongoRepo implements Repo {
  constructor(
    private col: Collection<Doc>,
    private contaId: string,
  ) {}

  async add(l: NovoLancamento) {
    try {
      await this.col.insertOne({ ...l, contaId: this.contaId, desfeitoEm: null })
      return 'ok' as const
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return 'duplicado' as const // índice único (contaId, msgId)
      throw err
    }
  }

  async desfazerUltimo() {
    return this.col.findOneAndUpdate(
      { contaId: this.contaId, desfeitoEm: null },
      { $set: { desfeitoEm: new Date() } },
      { sort: { enviadoEm: -1, _id: -1 }, returnDocument: 'after' },
    )
  }

  async extrato(intervalo: { de: Date; ate: Date }) {
    return this.col
      .find({ contaId: this.contaId, desfeitoEm: null, data: { $gte: intervalo.de, $lt: intervalo.ate } })
      .sort({ data: 1, enviadoEm: 1, _id: 1 })
      .toArray()
  }

  async balancete(intervalo: Intervalo): Promise<Balancete> {
    const match: Filter<Doc> = { contaId: this.contaId, desfeitoEm: null }
    if (intervalo) match.data = { $gte: intervalo.de, $lt: intervalo.ate }
    const grupos = await this.col
      .aggregate<{ _id: { tipo: Natureza; conta: string }; total: number }>([
        { $match: match },
        { $group: { _id: { tipo: '$tipo', conta: '$conta' }, total: { $sum: '$valor' } } },
        { $sort: { total: -1, '_id.conta': 1 } },
      ])
      .toArray()
    const linhas = (t: Natureza) =>
      grupos.filter((g) => g._id.tipo === t).map((g) => ({ conta: g._id.conta, total: g.total }))
    return { receitas: linhas('receita'), despesas: linhas('despesa') }
  }
}

export async function conectarMongo(uri: string, dbName: string) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 })
  await client.connect()
  const db = client.db(dbName)
  const col = db.collection<Doc>('lancamentos')
  // o índice único antigo (só msgId) impediria o mesmo msgId em contas diferentes
  await col.dropIndex('msgId_1').catch((err: { code?: number }) => {
    if (err.code !== 26 && err.code !== 27) throw err // 26 = coleção inexistente, 27 = índice inexistente
  })
  await col.createIndex({ contaId: 1, msgId: 1 }, { unique: true })
  await col.createIndex({ contaId: 1, data: 1 })
  return { db, repoDe: (contaId: string) => new MongoRepo(col, contaId) as Repo, close: () => client.close() }
}
