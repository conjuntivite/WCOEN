import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // ponytail: vários arquivos de teste batem nas mesmas tabelas do Postgres local (contas/logins/convites);
    // rodar em paralelo causa corrida entre DROP TABLE de um arquivo e query de outro. Suíte é rápida (~8s),
    // então serializar os arquivos é mais simples que isolar por schema/banco por arquivo.
    fileParallelism: false,
  },
})
