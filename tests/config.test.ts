import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

describe('loadConfig', () => {
  it('lê variáveis e aplica defaults', () => {
    expect(loadConfig({ MONGO_URI: 'mongodb://x' })).toEqual({
      mongoUri: 'mongodb://x',
      mongoDb: 'wcoen',
      groupId: '',
    })
  })

  it('respeita MONGO_DB e GROUP_ID', () => {
    const c = loadConfig({ MONGO_URI: 'mongodb://x', MONGO_DB: 'outro', GROUP_ID: '123@g.us' })
    expect(c.mongoDb).toBe('outro')
    expect(c.groupId).toBe('123@g.us')
  })

  it('falha sem MONGO_URI', () => {
    expect(() => loadConfig({})).toThrow('MONGO_URI não definido no .env')
  })

  it('OpenRouter é opcional: sem chave (ou chave vazia) fica desligado', () => {
    expect(loadConfig({ MONGO_URI: 'mongodb://x' }).openrouter).toBeUndefined()
    expect(loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: '', OPENROUTER_MODEL: '' }).openrouter).toBeUndefined()
  })

  it('lê chave e modelo: só os de OPENROUTER_MODEL, sem reserva gratuita', () => {
    const c = loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'um/modelo' })
    expect(c.openrouter).toEqual({ apiKey: 'k', models: ['um/modelo'] })
  })

  it('OPENROUTER_MODEL aceita vários modelos, em ordem', () => {
    const c = loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'a/1, b/2' })
    expect(c.openrouter?.models).toEqual(['a/1', 'b/2'])
  })

  it('OPENROUTER_FALLBACK_MODELS é ignorada: nada de modelo fora do OPENROUTER_MODEL', () => {
    const c = loadConfig({
      MONGO_URI: 'mongodb://x',
      OPENROUTER_API_KEY: 'k',
      OPENROUTER_MODEL: 'um/modelo',
      OPENROUTER_FALLBACK_MODELS: 'x/1:free',
    })
    expect(c.openrouter?.models).toEqual(['um/modelo'])
  })

  it('exige o modelo quando há chave', () => {
    expect(() => loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: 'k' })).toThrow('OPENROUTER_MODEL não definido')
  })
})
