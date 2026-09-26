import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import { atrasoReconexao } from './backoff'
import type { Mensagem, Resposta } from './service'

export type OpcoesWhatsApp = {
  groupId: string
  tratar: (msg: Mensagem, recuperada: boolean) => Promise<Resposta | null>
  authDir?: string
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function iniciarWhatsApp({ groupId, tratar, authDir = 'auth' }: OpcoesWhatsApp) {
  let sock: WASocket | undefined
  let tentativa = 0
  let primeiraConexao = true // "🟢 Bot online" só na partida do processo, não a cada reconexão
  let parando = false
  let conectouEm = 0 // segundos, mesma unidade de messageTimestamp
  let recuperados = 0
  let timerResumo: NodeJS.Timeout | undefined
  let fila: Promise<void> = Promise.resolve() // uma mensagem por vez, na ordem em que chegam
  const enviados = new Set<string>() // anti-loop: IDs das mensagens que o próprio bot mandou

  async function enviar(texto: string) {
    if (!sock) return
    await dormir(500 + Math.random() * 1000) // pequeno atraso, menos robótico
    const r = await sock.sendMessage(groupId, { text: texto })
    if (r?.key.id) enviados.add(r.key.id)
  }

  function agendarResumo() {
    clearTimeout(timerResumo)
    timerResumo = setTimeout(async () => {
      const n = recuperados
      recuperados = 0
      const s = n > 1 ? 's' : ''
      await enviar(`📥 Recuperei ${n} lançamento${s} feito${s} enquanto eu estava offline`).catch(console.error)
    }, 5000)
  }

  async function aoAbrir() {
    if (!groupId) {
      let grupos
      try {
        grupos = await sock!.groupFetchAllParticipating()
      } catch (err) {
        console.error('Não consegui listar os grupos. Tente de novo.', err)
        process.exit(1)
      }
      console.log('Grupos encontrados. Copie o ID do seu grupo para GROUP_ID no .env e reinicie:')
      for (const g of Object.values(grupos)) console.log(`  ${g.id}  ${g.subject}`)
      await dormir(1000) // deixa a sessão terminar de ser salva
      process.exit(0)
    }
    if (primeiraConexao) {
      primeiraConexao = false
      await enviar('🟢 Bot online')
    }
  }

  async function tratarMensagem(m: WAMessage) {
    try {
      const id = m.key.id
      if (!id || m.key.remoteJid !== groupId || enviados.has(id)) return
      const conteudo = normalizeMessageContent(m.message) // desembrulha mensagens temporárias / visualização única
      const texto = conteudo?.conversation ?? conteudo?.extendedTextMessage?.text
      if (!texto) return

      const ts = Number(m.messageTimestamp) || 0
      const enviadoEm = new Date((ts || Date.now() / 1000) * 1000)
      const remetente = m.key.fromMe
        ? jidNormalizedUser(sock?.user?.id ?? '')
        : (m.key.participant ?? '')
      // enviada antes de reconectar = chegou enquanto o bot estava offline
      const recuperada = ts > 0 && ts < conectouEm - 2

      const r = await tratar({ msgId: id, remetente, texto, enviadoEm }, recuperada)
      if (!r) return
      if (recuperada && r.lancou) {
        recuperados++
        agendarResumo()
        return
      }
      await enviar(r.texto)
    } catch (err) {
      console.error('erro no adaptador', err)
    }
  }

  async function conectar() {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()
    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
    })
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) qrcode.generate(qr, { small: true })
      if (connection === 'open') {
        tentativa = 0
        conectouEm = Math.floor(Date.now() / 1000)
        await aoAbrir().catch(console.error)
      }
      if (connection === 'close' && !parando) {
        const codigo = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode
        if (codigo === DisconnectReason.loggedOut) {
          console.error('Sessão encerrada pelo WhatsApp. Apague a pasta ./auth e escaneie o QR de novo.')
          process.exit(1)
        }
        if (codigo === DisconnectReason.connectionReplaced) {
          console.error('Outra instância assumiu esta sessão do WhatsApp. Feche a outra e reinicie o bot.')
          process.exit(1)
        }
        const espera = atrasoReconexao(tentativa++)
        console.warn(`Conexão caiu (código ${codigo}); nova tentativa em ${espera / 1000}s`)
        setTimeout(() => conectar().catch(console.error), espera)
      }
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      // 'append' = mensagens que chegaram offline (e ecos dos envios do próprio bot, barrados por `enviados`)
      if (type !== 'notify' && type !== 'append') return
      for (const m of messages) fila = fila.then(() => tratarMensagem(m))
    })
  }

  await conectar()

  return {
    async desligar() {
      parando = true
      await Promise.race([fila, dormir(5000)]) // deixa a mensagem em andamento terminar (com prazo)
      try {
        await enviar('🔴 Bot desligando')
      } catch (err) {
        console.error('não consegui avisar o desligamento', err)
      }
      sock?.end(undefined)
    },
  }
}
