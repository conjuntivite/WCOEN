import { criarContas } from '../contas'
import { conectarPostgres } from '../db'

const [email, senha] = process.argv.slice(2)
const url = process.env.DATABASE_URL
if (!email || !senha || !url) {
  console.error('Uso: npm run senha -- <e-mail> <nova senha (mín. 8 caracteres)>  (DATABASE_URL vem do .env)')
  process.exit(1)
}
const { pool, close } = await conectarPostgres(url)
try {
  const contas = await criarContas(pool, { convite: '' })
  console.log((await contas.redefinirSenha(email, senha)) ? 'Senha redefinida; os logins ativos foram encerrados.' : 'Conta não encontrada ou senha curta demais.')
} finally {
  await close()
}
