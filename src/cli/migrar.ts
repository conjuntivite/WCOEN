import { migrarLegado } from '../migrar'
import { conectarMongo } from '../repo'

const [email] = process.argv.slice(2)
const uri = process.env.MONGO_URI
if (!email || !uri) {
  console.error('Uso: npm run migrar -- <e-mail da conta dona dos lançamentos atuais>  (MONGO_URI vem do .env)')
  process.exit(1)
}
const { db, close } = await conectarMongo(uri, process.env.MONGO_DB || 'wcoen')
try {
  console.log(`${await migrarLegado(db, email)} lançamento(s) atribuído(s) a ${email}`)
} finally {
  await close()
}
