import { defineConfig } from 'vitest/config'

// testes de páginas são puros (HTML em string): rodam sem Postgres
export default defineConfig({ test: {} })
