// Etapa 0: lê as fotos de piloto/ com OPENROUTER_VISION_MODEL. Para em US$ 1 ou 30 fotos.
// Faz chamadas PAGAS e envia as fotos ao provedor: só rode com fotos autorizadas.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { formatBRL } from '../src/money'
import { criarExtratorOpenRouter } from '../src/nota'

const TETO_USD = 1
const MAX_FOTOS = 30
const PASTA = 'piloto'
const MIMES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

const apiKey = process.env.OPENROUTER_API_KEY
const model = process.env.OPENROUTER_VISION_MODEL?.trim()
if (!apiKey || !model) throw new Error('defina OPENROUTER_API_KEY e OPENROUTER_VISION_MODEL no .env')
if (model.endsWith(':free')) throw new Error('modelo gratuito não: as fotos têm dados de terceiros')

const fotos = (await readdir(PASTA)).filter((f) => MIMES[extname(f).toLowerCase()]).sort().slice(0, MAX_FOTOS)
if (!fotos.length) throw new Error(`nenhuma foto .jpg/.png/.webp em ${PASTA}/`)

const ex = criarExtratorOpenRouter({ apiKey, model })
const resultados: unknown[] = []
let gasto = 0
let ultimoCusto = 0
for (const foto of fotos) {
  if (gasto + ultimoCusto > TETO_USD) {
    console.log(`Parei: a próxima chamada passaria do teto de US$ ${TETO_USD} (gasto até aqui: US$ ${gasto.toFixed(4)}).`)
    break
  }
  const inicio = Date.now()
  try {
    const { leitura, custoUsd } = await ex.ler(await readFile(join(PASTA, foto)), MIMES[extname(foto).toLowerCase()])
    const ms = Date.now() - inicio
    resultados.push({ foto, ms, leitura, custoUsd })
    console.log(`${foto}: ${leitura.legivel ? formatBRL(leitura.total ?? 0) : 'ILEGÍVEL'} | ${leitura.data ?? '-'} | ${leitura.emitente ?? '-'} | ${leitura.categoria ?? '-'} | ${ms} ms | US$ ${custoUsd ?? '?'}`)
    if (custoUsd === undefined) {
      console.log('Parei: o OpenRouter não informou o custo, então não dá para garantir o teto.')
      break
    }
    gasto += custoUsd
    ultimoCusto = custoUsd
  } catch (err) {
    resultados.push({ foto, ms: Date.now() - inicio, erro: err instanceof Error ? err.message : String(err) })
    console.log(`${foto}: ERRO ${err instanceof Error ? err.message : err}`)
  }
}
await writeFile(join(PASTA, 'resultado.json'), JSON.stringify({ model, gastoUsd: gasto, resultados }, null, 2))
console.log(`\n${resultados.length} foto(s), US$ ${gasto.toFixed(4)} no total. Detalhes em ${PASTA}/resultado.json`)
