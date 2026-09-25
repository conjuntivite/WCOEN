// Reserva gratuita padrão (lista do outro projeto do usuário; modelos gratuitos mudam e sofrem 429): substituível por OPENROUTER_FALLBACK_MODELS
const GRATUITOS_PADRAO = ['nvidia/nemotron-3-super-120b-a12b:free', 'z-ai/glm-5.2:free', 'google/gemma-4-31b-it:free']
const lista = (v?: string) => (v ?? '').split(',').map((m) => m.trim()).filter(Boolean)

export type Config = {
  mongoUri: string
  mongoDb: string
  groupId: string
  openrouter?: { apiKey: string; models: string[] } // opcional: sem chave, o agrupamento por IA fica desligado; models em ordem de tentativa
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mongoUri = env.MONGO_URI
  if (!mongoUri) throw new Error('MONGO_URI não definido no .env')

  let openrouter: Config['openrouter']
  if (env.OPENROUTER_API_KEY) {
    const principais = lista(env.OPENROUTER_MODEL)
    if (!principais.length) throw new Error('OPENROUTER_MODEL não definido no .env (obrigatório com OPENROUTER_API_KEY)')
    const reserva = lista(env.OPENROUTER_FALLBACK_MODELS)
    openrouter = {
      apiKey: env.OPENROUTER_API_KEY,
      models: [...new Set([...principais, ...(reserva.length ? reserva : GRATUITOS_PADRAO)])],
    }
  }
  return { mongoUri, mongoDb: env.MONGO_DB || 'wcoen', groupId: env.GROUP_ID ?? '', openrouter }
}
