const lista = (v?: string) => (v ?? '').split(',').map((m) => m.trim()).filter(Boolean)

export type Config = {
  mongoUri: string
  mongoDb: string
  groupId: string
  openrouter?: { apiKey: string; models: string[] } // opcional: sem chave, a auditoria fica desligada; models (só pagos) em ordem de tentativa
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mongoUri = env.MONGO_URI
  if (!mongoUri) throw new Error('MONGO_URI não definido no .env')

  let openrouter: Config['openrouter']
  if (env.OPENROUTER_API_KEY) {
    const models = [...new Set(lista(env.OPENROUTER_MODEL))]
    if (!models.length) throw new Error('OPENROUTER_MODEL não definido no .env (obrigatório com OPENROUTER_API_KEY)')
    openrouter = { apiKey: env.OPENROUTER_API_KEY, models }
  }
  return { mongoUri, mongoDb: env.MONGO_DB || 'wcoen', groupId: env.GROUP_ID ?? '', openrouter }
}
