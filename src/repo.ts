import { MongoClient, type Collection, type Filter } from 'mongodb'
import type { Balancete, Intervalo, Lancamento, Natureza, NovoLancamento, Repo } from './types'

class MongoRepo implements Repo {
  constructor(private col: Collection<Lancamento>) {}

  async add(l: NovoLancamento) {
    try {
      await this.col.insertOne({ ...l, desfeitoEm: null })
      return 'ok' as const
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return 'duplicado' as const // índice único de msgId
      throw err
    }
  }

  async desfazerUltimo() {
    return this.col.findOneAndUpdate(
      { desfeitoEm: null },
      { $set: { desfeitoEm: new Date() } },
      { sort: { enviadoEm: -1, _id: -1 }, returnDocument: 'after' },
    )
  }

  async extrato(intervalo: { de: Date; ate: Date }) {
    return this.col
      .find({ desfeitoEm: null, data: { $gte: intervalo.de, $lt: intervalo.ate } })
      .sort({ data: 1, enviadoEm: 1, _id: 1 })
      .toArray()
  }

  async balancete(intervalo: Intervalo): Promise<Balancete> {
    const match: Filter<Lancamento> = { desfeitoEm: null }
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
  const col = client.db(dbName).collection<Lancamento>('lancamentos')
  await col.createIndex({ msgId: 1 }, { unique: true })
  await col.createIndex({ data: 1 })
  return { repo: new MongoRepo(col) as Repo, close: () => client.close() }
}
