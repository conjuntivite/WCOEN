import makeWASocket, { fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import pino from 'pino'
import type { Auth, SocketMin } from './sessoes'

export async function criarSocketBaileys(auth: Auth): Promise<SocketMin> {
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: auth.state, logger: pino({ level: 'silent' }), markOnlineOnConnect: false })
  return sock as unknown as SocketMin // o WASocket tem estes métodos; o tipo mínimo evita acoplar os testes ao Baileys
}
