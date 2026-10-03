const lista = (v?: string) => (v ?? '').split(',').map((m) => m.trim()).filter(Boolean)

export type Config = {
  databaseUrl: string
  porta: number
  dominio?: string // com DOMINIO o portal assume HTTPS atrás do proxy (cookie Secure, IP do X-Forwarded-For)
  convite: string // código exigido no cadastro (cadastro fechado)
  chaveCripto: Buffer // 32 bytes; criptografa as credenciais do WhatsApp no banco
  maxSessoes: number
  adminEmails: string[] // veem /admin e podem criar/revogar convites; normalizados (minúsculo, sem espaços)
  openrouter?: { apiKey: string; models: string[]; visionModel?: string } // opcional: sem chave, a auditoria fica desligada; models (só pagos) em ordem de tentativa; visionModel liga o /nota
  smtp?: { host: string; port: number; user: string; pass: string; from: string } // opcional: sem SMTP_HOST, o link de redefinição só é logado no console
  resend?: { apiKey: string; from: string } // opcional: e-mail por API HTTPS (vale no Render gratuito, que bloqueia SMTP); tem prioridade sobre o SMTP
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL não definido no .env')
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
    const visionModel = env.OPENROUTER_VISION_MODEL?.trim()
    if (visionModel?.endsWith(':free')) throw new Error('OPENROUTER_VISION_MODEL não pode ser gratuito (:free): a foto da nota tem dados de terceiros')
    openrouter = { apiKey: env.OPENROUTER_API_KEY, models, ...(visionModel && { visionModel }) }
  }

  let smtp: Config['smtp']
  if (env.SMTP_HOST) {
    const user = env.SMTP_USER ?? ''
    const pass = env.SMTP_PASS ?? ''
    smtp = { host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, user, pass, from: env.SMTP_FROM || user }
  }

  const resend = env.RESEND_API_KEY ? { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM || 'WCOEN <onboarding@resend.dev>' } : undefined

  return {
    databaseUrl,
    porta: Number(env.PORTA) || 3000,
    dominio: env.DOMINIO || undefined,
    convite,
    chaveCripto: Buffer.from(chave, 'hex'),
    maxSessoes: Number(env.MAX_SESSOES) || 20,
    adminEmails: lista(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    openrouter,
    smtp,
    resend,
  }
}
