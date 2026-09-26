const lista = (v?: string) => (v ?? '').split(',').map((m) => m.trim()).filter(Boolean)

export type Config = {
  mongoUri: string
  mongoDb: string
  porta: number
  dominio?: string // com DOMINIO o portal assume HTTPS atrás do Caddy (cookie Secure, IP do X-Forwarded-For)
  convite: string // código exigido no cadastro (cadastro fechado)
  chaveCripto: Buffer // 32 bytes; criptografa as credenciais do WhatsApp no Mongo
  maxSessoes: number
  openrouter?: { apiKey: string; models: string[] } // opcional: sem chave, a auditoria fica desligada; models (só pagos) em ordem de tentativa
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const mongoUri = env.MONGO_URI
  if (!mongoUri) throw new Error('MONGO_URI não definido no .env')
  const convite = env.CONVITE
  if (!convite) throw new Error('CONVITE não definido no .env')
  const chave = env.CHAVE_CRIPTO ?? ''
  if (!/^[0-9a-f]{64}$/i.test(chave)) {
    throw new Error('CHAVE_CRIPTO deve ter 64 caracteres hexadecimais (32 bytes). Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }

  let openrouter: Config['openrouter']
  if (env.OPENROUTER_API_KEY) {
    const models = [...new Set(lista(env.OPENROUTER_MODEL))]
    if (!models.length) throw new Error('OPENROUTER_MODEL não definido no .env (obrigatório com OPENROUTER_API_KEY)')
    openrouter = { apiKey: env.OPENROUTER_API_KEY, models }
  }
  return {
    mongoUri,
    mongoDb: env.MONGO_DB || 'wcoen',
    porta: Number(env.PORTA) || 3000,
    dominio: env.DOMINIO || undefined,
    convite,
    chaveCripto: Buffer.from(chave, 'hex'),
    maxSessoes: Number(env.MAX_SESSOES) || 20,
    openrouter,
  }
}
