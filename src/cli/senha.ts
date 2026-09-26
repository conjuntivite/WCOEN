import { criarContas } from '../contas'
import { conectarMongo } from '../repo'

const [email, senha] = process.argv.slice(2)
const uri = process.env.MONGO_URI
if (!email || !senha || !uri) {
  console.error('Uso: npm run senha -- <e-mail> <nova senha (mín. 8 caracteres)>  (MONGO_URI vem do .env)')
  process.exit(1)
}
const { db, close } = await conectarMongo(uri, process.env.MONGO_DB || 'wcoen')
try {
  const contas = await criarContas(db, { convite: '' })
  console.log((await contas.redefinirSenha(email, senha)) ? 'Senha redefinida; os logins ativos foram encerrados.' : 'Conta não encontrada ou senha curta demais.')
} finally {
  await close()
}
