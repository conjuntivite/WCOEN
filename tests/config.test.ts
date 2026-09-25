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

  it('lê chave e modelo; depois do modelo principal entram os gratuitos de reserva', () => {
    const c = loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'um/modelo' })
    expect(c.openrouter?.apiKey).toBe('k')
    expect(c.openrouter?.models[0]).toBe('um/modelo')
    expect(c.openrouter!.models.length).toBeGreaterThan(1)
    expect(c.openrouter!.models.slice(1).every((m) => m.endsWith(':free'))).toBe(true)
  })

  it('OPENROUTER_MODEL aceita vários modelos, em ordem', () => {
    const c = loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'a/1, b/2' })
    expect(c.openrouter?.models.slice(0, 2)).toEqual(['a/1', 'b/2'])
  })

  it('OPENROUTER_FALLBACK_MODELS substitui a reserva padrão e não repete modelos', () => {
    const c = loadConfig({
      MONGO_URI: 'mongodb://x',
      OPENROUTER_API_KEY: 'k',
      OPENROUTER_MODEL: 'um/modelo',
      OPENROUTER_FALLBACK_MODELS: 'x/1:free, um/modelo, y/2:free',
    })
    expect(c.openrouter?.models).toEqual(['um/modelo', 'x/1:free', 'y/2:free'])
  })

  it('exige o modelo quando há chave', () => {
    expect(() => loadConfig({ MONGO_URI: 'mongodb://x', OPENROUTER_API_KEY: 'k' })).toThrow('OPENROUTER_MODEL não definido')
  })
})
