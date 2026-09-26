import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

const CHAVE = 'a'.repeat(64)
const base = { MONGO_URI: 'mongodb://x', CONVITE: 'convite-piloto', CHAVE_CRIPTO: CHAVE }

describe('loadConfig', () => {
  it('lê variáveis e aplica defaults', () => {
    expect(loadConfig(base)).toEqual({
      mongoUri: 'mongodb://x',
      mongoDb: 'wcoen',
      porta: 3000,
      convite: 'convite-piloto',
      chaveCripto: Buffer.from(CHAVE, 'hex'),
      maxSessoes: 20,
    })
  })

  it('respeita MONGO_DB, PORTA, DOMINIO e MAX_SESSOES', () => {
    const c = loadConfig({ ...base, MONGO_DB: 'outro', PORTA: '8080', DOMINIO: 'app.exemplo.com', MAX_SESSOES: '5' })
    expect(c).toMatchObject({ mongoDb: 'outro', porta: 8080, dominio: 'app.exemplo.com', maxSessoes: 5 })
  })

  it('falha sem MONGO_URI', () => {
    expect(() => loadConfig({ ...base, MONGO_URI: undefined })).toThrow('MONGO_URI não definido no .env')
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
})
