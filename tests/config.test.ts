import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const CHAVE = 'a'.repeat(64)
const base = { DATABASE_URL: 'postgres://x', CONVITE: 'convite-piloto', CHAVE_CRIPTO: CHAVE }

describe('loadConfig', () => {
  it('lê variáveis e aplica defaults', () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: 'postgres://x',
      porta: 3000,
      convite: 'convite-piloto',
      chaveCripto: Buffer.from(CHAVE, 'hex'),
      maxSessoes: 20,
      adminEmails: [],
    })
  })

  it('ADMIN_EMAILS: normaliza (minúsculo, sem espaços) e ignora vazios; sem a variável, lista vazia', () => {
    expect(loadConfig(base).adminEmails).toEqual([])
    const c = loadConfig({ ...base, ADMIN_EMAILS: ' Ana@X.com, , bob@X.COM ' })
    expect(c.adminEmails).toEqual(['ana@x.com', 'bob@x.com'])
  })

  it('respeita PORTA, DOMINIO e MAX_SESSOES', () => {
    const c = loadConfig({ ...base, PORTA: '8080', DOMINIO: 'app.exemplo.com', MAX_SESSOES: '5' })
    expect(c).toMatchObject({ porta: 8080, dominio: 'app.exemplo.com', maxSessoes: 5 })
  })

  it('falha sem DATABASE_URL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow('DATABASE_URL não definido')
  })

  it('cadastro fechado: exige CONVITE', () => {
    expect(() => loadConfig({ ...base, CONVITE: '' })).toThrow('CONVITE não definido no .env')
  })

  it('exige CHAVE_CRIPTO com 64 caracteres hexadecimais', () => {
    expect(() => loadConfig({ ...base, CHAVE_CRIPTO: undefined })).toThrow('CHAVE_CRIPTO')
    expect(() => loadConfig({ ...base, CHAVE_CRIPTO: 'curta' })).toThrow('CHAVE_CRIPTO')
    expect(() => loadConfig({ ...base, CHAVE_CRIPTO: 'z'.repeat(64) })).toThrow('CHAVE_CRIPTO')
  })

  it('OpenRouter é opcional: sem chave (ou chave vazia) fica desligado', () => {
    expect(loadConfig(base).openrouter).toBeUndefined()
    expect(loadConfig({ ...base, OPENROUTER_API_KEY: '', OPENROUTER_MODEL: '' }).openrouter).toBeUndefined()
  })

  it('lê chave e modelo: só os de OPENROUTER_MODEL, sem reserva gratuita', () => {
    const c = loadConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'um/modelo' })
    expect(c.openrouter).toEqual({ apiKey: 'k', models: ['um/modelo'] })
  })

  it('OPENROUTER_MODEL aceita vários modelos, em ordem', () => {
    const c = loadConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'a/1, b/2' })
    expect(c.openrouter?.models).toEqual(['a/1', 'b/2'])
  })

  it('OPENROUTER_FALLBACK_MODELS é ignorada: nada de modelo fora do OPENROUTER_MODEL', () => {
    const c = loadConfig({ ...base, OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'um/modelo', OPENROUTER_FALLBACK_MODELS: 'x/1:free' })
    expect(c.openrouter?.models).toEqual(['um/modelo'])
  })

  it('exige o modelo quando há chave', () => {
    expect(() => loadConfig({ ...base, OPENROUTER_API_KEY: 'k' })).toThrow('OPENROUTER_MODEL não definido')
  })

  it('SMTP é opcional: sem SMTP_HOST fica desligado', () => {
    expect(loadConfig(base).smtp).toBeUndefined()
  })

  it('lê SMTP com defaults de porta e remetente (SMTP_FROM cai pro SMTP_USER)', () => {
    const c = loadConfig({ ...base, SMTP_HOST: 'smtp.exemplo.com', SMTP_USER: 'bot@exemplo.com', SMTP_PASS: 'segredo' })
    expect(c.smtp).toEqual({ host: 'smtp.exemplo.com', port: 587, user: 'bot@exemplo.com', pass: 'segredo', from: 'bot@exemplo.com' })
  })

  it('SMTP_PORT e SMTP_FROM sobrescrevem os defaults', () => {
    const c = loadConfig({ ...base, SMTP_HOST: 'smtp.exemplo.com', SMTP_PORT: '465', SMTP_USER: 'bot@exemplo.com', SMTP_PASS: 'segredo', SMTP_FROM: 'no-reply@exemplo.com' })
    expect(c.smtp).toMatchObject({ port: 465, from: 'no-reply@exemplo.com' })
  })

  it('DEV é opcional: sem DEV_EMAIL/DEV_PASSWORD fica desligado', () => {
    expect(loadConfig(base).dev).toBeUndefined()
  })

  it('lê e normaliza DEV_EMAIL; exige os dois definidos juntos', () => {
    const c = loadConfig({ ...base, DEV_EMAIL: ' Dev@X.com ', DEV_PASSWORD: 'senha-dev-123' })
    expect(c.dev).toEqual({ email: 'dev@x.com', senha: 'senha-dev-123' })
    expect(() => loadConfig({ ...base, DEV_EMAIL: 'dev@x.com' })).toThrow('DEV_EMAIL e DEV_PASSWORD')
    expect(() => loadConfig({ ...base, DEV_PASSWORD: 'senha-dev-123' })).toThrow('DEV_EMAIL e DEV_PASSWORD')
  })
})
