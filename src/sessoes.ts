import { DisconnectReason, jidNormalizedUser, normalizeMessageContent, type AuthenticationState, type WAMessage } from '@whiskeysockets/baileys'
import { atrasoReconexao } from './backoff'
import { BOAS_VINDAS, recuperados } from './presentation'
import type { Mensagem, Resposta } from './service'

export type Estado = 'desconectado' | 'aguardando_qr' | 'conectando' | 'conectado'
export type Aviso = 'qr_expirado' | 'sessao_encerrada' | 'sessao_assumida' | 'servidor_lotado' | 'erro'
export type Visao = { estado: Estado; qr?: string; codigo?: string; aviso?: Aviso }

// só o que usamos do WASocket; o adaptador real (src/baileys.ts) e o socket falso dos testes cumprem isto
export type SocketMin = {
  ev: { on(evento: string, ouvinte: (dados: any) => void): void }
  user?: { id: string }
  sendMessage(jid: string, conteudo: { text: string }): Promise<{ key: { id?: string | null } } | undefined>
  groupFetchAllParticipating(): Promise<Record<string, { id: string; subject: string }>>
  requestPairingCode(telefone: string): Promise<string>
  logout(): Promise<void>
  end(erro: Error | undefined): void
}
export type Auth = { state: AuthenticationState; saveCreds: () => Promise<unknown> }
export type ServicoDaConta = { handle(msg: Mensagem, opcoes: { recuperada?: boolean }): Promise<Resposta | null> }

export type DepsSessoes = {
  criarAuth: (contaId: string) => Promise<Auth>
  apagarAuth: (contaId: string) => Promise<void>
  criarSocket: (auth: Auth) => Promise<SocketMin>
  criarService: (contaId: string) => ServicoDaConta
  grupoDa: (contaId: string) => Promise<string | undefined>
  salvarGrupo: (contaId: string, grupoId: string, grupoNome: string) => Promise<void>
  marcarConectada: (contaId: string, conectada: boolean) => Promise<void>
  maxSessoes?: number // padrão 20
  qrMaxMs?: number // padrão 120 000
  dormir?: (ms: number) => Promise<void>
  agora?: () => number // ms
}

type Grupo = { id: string; nome: string }
type Sessao = {
  contaId: string
  estado: Estado
  qr?: string
  codigo?: string
  aviso?: Aviso
  sock?: SocketMin // undefined = nenhum socket "atual"; eventos de sockets antigos são ignorados
  service: ServicoDaConta
  grupoId?: string
  tentativa: number
  encerrada: boolean // desconectar()/encerrar(): nunca reconectar
  conectouEm: number // segundos, mesma unidade de messageTimestamp
  recuperados: number
  fila: Promise<void> // uma mensagem por vez, na ordem em que chegam
  enviados: Set<string> // anti-loop: IDs das mensagens que o próprio bot mandou
  cacheGrupos?: { em: number; lista: Grupo[] }
  timerQr?: ReturnType<typeof setTimeout>
  timerReconexao?: ReturnType<typeof setTimeout>
  timerResumo?: ReturnType<typeof setTimeout>
  ouvintes: Set<(v: Visao) => void>
}

const CACHE_GRUPOS_MS = 60_000

export function criarSessoes(deps: DepsSessoes) {
  const max = deps.maxSessoes ?? 20
  const qrMaxMs = deps.qrMaxMs ?? 120_000
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const agora = deps.agora ?? Date.now
  const sessoes = new Map<string, Sessao>()

  const log = (s: Sessao, onde: string, err: unknown) => console.error(`[conta ${s.contaId}] ${onde}:`, err instanceof Error ? err.message : err)

  function sessaoDe(contaId: string): Sessao {
    let s = sessoes.get(contaId)
    if (!s) {
      s = { contaId, estado: 'desconectado', service: deps.criarService(contaId), tentativa: 0, encerrada: false, conectouEm: 0, recuperados: 0, fila: Promise.resolve(), enviados: new Set(), ouvintes: new Set() }
      sessoes.set(contaId, s)
    }
    return s
  }

  const visaoDe = (s: Sessao): Visao => {
    const v: Visao = { estado: s.estado }
    if (s.qr) v.qr = s.qr
    if (s.codigo) v.codigo = s.codigo
    if (s.aviso) v.aviso = s.aviso
    return v
  }

  function mudar(s: Sessao, parcial: Partial<Pick<Sessao, 'estado' | 'qr' | 'codigo' | 'aviso'>>) {
    Object.assign(s, parcial)
    for (const f of s.ouvintes) {
      try {
        f(visaoDe(s))
      } catch (err) {
        log(s, 'ouvinte', err)
      }
    }
  }

  function limparTimers(s: Sessao) {
    clearTimeout(s.timerQr)
    clearTimeout(s.timerReconexao)
    clearTimeout(s.timerResumo)
    s.timerQr = s.timerReconexao = s.timerResumo = undefined
  }

  // ouvinte de evento do socket: erro de uma conta nunca escapa
  function ouvir(s: Sessao, sock: SocketMin, evento: string, fn: (dados: any) => unknown) {
    sock.ev.on(evento, (dados) => {
      try {
        const r = fn(dados)
        if (r instanceof Promise) r.catch((err) => log(s, evento, err))
      } catch (err) {
        log(s, evento, err)
      }
    })
  }

  async function abrir(s: Sessao) {
    try {
      const auth = await deps.criarAuth(s.contaId)
      if (s.encerrada) return
      const sock = await deps.criarSocket(auth)
      s.sock = sock
      ouvir(s, sock, 'creds.update', () => auth.saveCreds())
      ouvir(s, sock, 'connection.update', (u) => aoAtualizar(s, sock, u))
      ouvir(s, sock, 'messages.upsert', ({ messages, type }: { messages: WAMessage[]; type: string }) => {
        // 'append' = mensagens que chegaram offline (e ecos dos envios do próprio bot, barrados por `enviados`)
        if (type !== 'notify' && type !== 'append') return
        for (const m of messages) s.fila = s.fila.then(() => tratar(s, m))
      })
    } catch (err) {
      log(s, 'abrir', err)
      s.sock = undefined
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'erro' })
    }
  }

  function aoAtualizar(s: Sessao, sock: SocketMin, u: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }) {
    if (s.sock !== sock) return // evento de um socket que já não é o atual
    if (u.qr) {
      s.timerQr ??= setTimeout(() => expirarQr(s), qrMaxMs)
      mudar(s, { estado: 'aguardando_qr', qr: u.qr })
    }
    if (u.connection === 'open') {
      clearTimeout(s.timerQr)
      s.timerQr = undefined
      s.tentativa = 0
      s.conectouEm = Math.floor(agora() / 1000)
      mudar(s, { estado: 'conectado', qr: undefined, codigo: undefined, aviso: undefined })
      deps.marcarConectada(s.contaId, true).catch((err) => log(s, 'marcarConectada', err))
    }
    if (u.connection === 'close' && !s.encerrada) {
      const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
      aoFechar(s, codigo)
    }
  }

  function aoFechar(s: Sessao, codigo?: number) {
    clearTimeout(s.timerQr)
    s.timerQr = undefined
    const eraQr = s.estado === 'aguardando_qr'
    s.sock = undefined
    if (codigo === DisconnectReason.loggedOut) {
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'sessao_encerrada' })
      Promise.all([deps.apagarAuth(s.contaId), deps.marcarConectada(s.contaId, false)]).catch((err) => log(s, 'loggedOut', err))
      return
    }
    if (codigo === DisconnectReason.connectionReplaced) {
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'sessao_assumida' })
      deps.marcarConectada(s.contaId, false).catch((err) => log(s, 'replaced', err))
      return
    }
    if (codigo === DisconnectReason.restartRequired) {
      // depois de escanear o QR o WhatsApp exige reiniciar a conexão: faz parte do pareamento
      mudar(s, { estado: 'conectando', qr: undefined })
      void abrir(s)
      return
    }
    if (codigo === DisconnectReason.timedOut && eraQr) {
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'qr_expirado' })
      return
    }
    mudar(s, { estado: 'conectando', qr: undefined })
    s.timerReconexao = setTimeout(() => {
      if (!s.encerrada) void abrir(s)
    }, atrasoReconexao(s.tentativa++))
  }

  function expirarQr(s: Sessao) {
    s.timerQr = undefined
    const sock = s.sock
    s.sock = undefined // o "close" que vem do end() será ignorado
    sock?.end(undefined)
    mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'qr_expirado' })
  }

  async function enviar(s: Sessao, texto: string) {
    const sock = s.sock
    if (!sock || !s.grupoId) return
    await dormir(500 + Math.random() * 1000) // pequeno atraso, menos robótico
    const r = await sock.sendMessage(s.grupoId, { text: texto })
    if (r?.key.id) s.enviados.add(r.key.id)
  }

  function agendarResumo(s: Sessao) {
    clearTimeout(s.timerResumo)
    s.timerResumo = setTimeout(() => {
      const n = s.recuperados
      s.recuperados = 0
      enviar(s, recuperados(n)).catch((err) => log(s, 'resumo', err))
    }, 5000)
  }

  async function tratar(s: Sessao, m: WAMessage) {
    try {
      const id = m.key.id
      if (!id || !s.grupoId || m.key.remoteJid !== s.grupoId || s.enviados.has(id)) return
      const conteudo = normalizeMessageContent(m.message) // desembrulha mensagens temporárias / visualização única
      const texto = conteudo?.conversation ?? conteudo?.extendedTextMessage?.text
      if (!texto) return

      const ts = Number(m.messageTimestamp) || 0
      const enviadoEm = new Date((ts || agora() / 1000) * 1000)
      const remetente = m.key.fromMe ? jidNormalizedUser(s.sock?.user?.id ?? '') : (m.key.participant ?? '')
      // enviada antes de reconectar = chegou enquanto o bot estava offline
      const recuperada = ts > 0 && ts < s.conectouEm - 2

      const r = await s.service.handle({ msgId: id, remetente, texto, enviadoEm }, { recuperada })
      if (!r) return
      if (recuperada && r.lancou) {
        s.recuperados++
        agendarResumo(s)
        return
      }
      await enviar(s, r.texto)
    } catch (err) {
      log(s, 'mensagem', err)
    }
  }

  async function listarGrupos(s: Sessao): Promise<Grupo[]> {
    if (s.estado !== 'conectado' || !s.sock) return []
    if (s.cacheGrupos && agora() - s.cacheGrupos.em < CACHE_GRUPOS_MS) return s.cacheGrupos.lista
    const todos = await s.sock.groupFetchAllParticipating()
    const lista = Object.values(todos)
      .map((g) => ({ id: g.id, nome: g.subject }))
      .sort((a, b) => a.nome.localeCompare(b.nome))
    s.cacheGrupos = { em: agora(), lista }
    return lista
  }

  return {
    async iniciar(contaId: string): Promise<void> {
      const s = sessaoDe(contaId)
      if (s.estado !== 'desconectado') return // clique duplo / duas abas: reaproveita a sessão
      const ativas = [...sessoes.values()].filter((x) => x.estado !== 'desconectado').length
      if (ativas >= max) {
        mudar(s, { aviso: 'servidor_lotado' })
        return
      }
      s.encerrada = false
      s.tentativa = 0
      mudar(s, { estado: 'conectando', qr: undefined, codigo: undefined, aviso: undefined }) // síncrono: fecha a porta para o clique duplo
      s.grupoId = await deps.grupoDa(contaId).catch(() => undefined)
      await abrir(s)
    },

    visao: (contaId: string): Visao => visaoDe(sessaoDe(contaId)),

    assinar(contaId: string, cb: (v: Visao) => void): () => void {
      const s = sessaoDe(contaId)
      s.ouvintes.add(cb)
      cb(visaoDe(s))
      return () => {
        s.ouvintes.delete(cb)
      }
    },

    grupos: (contaId: string): Promise<Grupo[]> => listarGrupos(sessaoDe(contaId)),

    async definirGrupo(contaId: string, grupoId: string): Promise<void> {
      const s = sessaoDe(contaId)
      if (s.estado !== 'conectado' || !s.sock) throw new Error('nao_conectado')
      const g = (await listarGrupos(s)).find((x) => x.id === grupoId)
      if (!g) throw new Error('grupo_invalido') // só vale grupo que está na lista da própria conta
      await deps.salvarGrupo(contaId, g.id, g.nome)
      s.grupoId = g.id
      await enviar(s, BOAS_VINDAS)
    },

    async parear(contaId: string, telefone: string): Promise<string> {
      const s = sessaoDe(contaId)
      const digitos = telefone.replace(/\D/g, '')
      if (digitos.length < 10 || digitos.length > 15) throw new Error('telefone_invalido')
      if (s.estado !== 'aguardando_qr' || !s.sock) throw new Error('indisponivel')
      const codigo = await s.sock.requestPairingCode(digitos)
      mudar(s, { codigo })
      return codigo
    },

    async desconectar(contaId: string): Promise<void> {
      const s = sessaoDe(contaId)
      s.encerrada = true
      limparTimers(s)
      const sock = s.sock
      s.sock = undefined
      if (sock) {
        await sock.logout().catch(() => {}) // sem sessão aberta o logout falha; tudo bem
        try {
          sock.end(undefined)
        } catch {}
      }
      await Promise.all([deps.apagarAuth(contaId), deps.marcarConectada(contaId, false)])
      s.cacheGrupos = undefined
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: undefined })
    },

    // reinício do servidor: uma conta a cada `intervaloMs`, para não abrir todas as conexões de uma vez
    async reabrir(contaIds: string[], intervaloMs = 3000): Promise<void> {
      for (const id of contaIds) {
        await this.iniciar(id).catch((err) => console.error(`[conta ${id}] reabrir:`, err instanceof Error ? err.message : err))
        await dormir(intervaloMs)
      }
    },

    async encerrar(): Promise<void> {
      const filas: Promise<void>[] = []
      for (const s of sessoes.values()) {
        s.encerrada = true
        limparTimers(s)
        filas.push(s.fila)
      }
      await Promise.race([Promise.all(filas), dormir(5000)]) // deixa as mensagens em andamento terminarem (com prazo)
      for (const s of sessoes.values()) {
        const sock = s.sock
        s.sock = undefined
        try {
          sock?.end(undefined)
        } catch {}
      }
    },
  }
}

export type Sessoes = ReturnType<typeof criarSessoes>
