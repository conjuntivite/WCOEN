import { DisconnectReason, jidNormalizedUser, normalizeMessageContent, type AuthenticationState, type WAMessage } from '@whiskeysockets/baileys'
import { atrasoReconexao } from './backoff'
import { criarLimitador } from './contas'
import { comandoDaPrevia, lerLegenda, montarPrevia, NOTA_ARQUIVO, NOTA_DESLIGADA, NOTA_FALHOU, NOTA_LIMITE, NOTA_NADA_PENDENTE, type Extrator } from './nota'
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
  notas?: { extrator: Extrator; baixar: (m: WAMessage) => Promise<Buffer> } // sem isto, "/nota" responde que a leitura está desligada
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
  geracao: number // sobe a cada iniciar()/desconectar(); um abrir() de geração antiga se aborta
  saida?: Promise<void> // desconectar() em andamento (apagar credenciais); iniciar() espera por ele
  conectouEm: number // segundos, mesma unidade de messageTimestamp
  recuperados: number
  fila: Promise<void> // uma mensagem por vez, na ordem em que chegam
  enviados: Set<string> // anti-loop: IDs das mensagens que o próprio bot mandou
  cacheGrupos?: { em: number; lista: Grupo[] }
  timerQr?: ReturnType<typeof setTimeout>
  timerReconexao?: ReturnType<typeof setTimeout>
  timerResumo?: ReturnType<typeof setTimeout>
  ouvintes: Set<(v: Visao) => void>
  // ponytail: só em memória; depois de um restart o /ok solto não acha a prévia (responder citando continua valendo)
  previa?: { id: string; comando: string; em: number } // última prévia de nota, para o /ok solto
}

const CACHE_GRUPOS_MS = 60_000
const MIMES_NOTA = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_BYTES_NOTA = 5 * 1024 * 1024
const PREVIA_PENDENTE_MS = 30 * 60_000 // o /ok solto só confirma prévia recente

export function criarSessoes(deps: DepsSessoes) {
  const max = deps.maxSessoes ?? 20
  const qrMaxMs = deps.qrMaxMs ?? 120_000
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const agora = deps.agora ?? Date.now
  const sessoes = new Map<string, Sessao>()
  const limiteNotas = criarLimitador(20, 60 * 60_000, agora) // por conta

  const log = (s: Sessao, onde: string, err: unknown) => console.error(`[conta ${s.contaId}] ${onde}:`, err instanceof Error ? err.message : err)

  function sessaoDe(contaId: string): Sessao {
    let s = sessoes.get(contaId)
    if (!s) {
      s = { contaId, estado: 'desconectado', service: deps.criarService(contaId), tentativa: 0, encerrada: false, geracao: 0, conectouEm: 0, recuperados: 0, fila: Promise.resolve(), enviados: new Set(), ouvintes: new Set() }
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

  async function abrir(s: Sessao, g = s.geracao) {
    const obsoleta = () => s.encerrada || s.geracao !== g // desconectar()/iniciar() aconteceu enquanto esperávamos
    try {
      const auth = await deps.criarAuth(s.contaId)
      if (obsoleta()) return
      const sock = await deps.criarSocket(auth)
      if (obsoleta()) {
        try {
          sock.end(undefined)
        } catch {}
        return
      }
      s.sock = sock
      ouvir(s, sock, 'creds.update', () => (s.sock === sock ? auth.saveCreds() : undefined)) // socket antigo não regrava credenciais apagadas
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
    return r?.key.id ?? undefined
  }

  function agendarResumo(s: Sessao) {
    clearTimeout(s.timerResumo)
    s.timerResumo = setTimeout(() => {
      const n = s.recuperados
      s.recuperados = 0
      enviar(s, recuperados(n)).catch((err) => log(s, 'resumo', err))
    }, 5000)
  }

  // Fora da fila serial: a IA leva segundos e os outros comandos da conta não esperam.
  // ponytail: a leitura em andamento se perde se o processo cair; o usuário reenvia a foto.
  async function lerNota(s: Sessao, m: WAMessage, img: { caption?: string | null; mimetype?: string | null; fileLength?: unknown }) {
    try {
      const legenda = lerLegenda(img.caption ?? '')
      if (!legenda) return
      if (!deps.notas) return await enviar(s, NOTA_DESLIGADA)
      if (limiteNotas.bloqueado(s.contaId)) return await enviar(s, NOTA_LIMITE)
      const mime = img.mimetype ?? ''
      if (!MIMES_NOTA.has(mime) || Number(img.fileLength) > MAX_BYTES_NOTA) return await enviar(s, NOTA_ARQUIVO)
      limiteNotas.falhou(s.contaId) // "falhou" = registra uma tentativa (o limitador nasceu para o login)
      const bytes = await deps.notas.baixar(m)
      if (bytes.length > MAX_BYTES_NOTA) return await enviar(s, NOTA_ARQUIVO)
      const { leitura } = await deps.notas.extrator.ler(bytes, mime)
      const previa = montarPrevia(leitura, legenda, new Date(agora()))
      const id = await enviar(s, previa)
      const comando = comandoDaPrevia(previa) // null = nota ilegível ou sem comando: nada a confirmar
      if (id && comando) s.previa = { id, comando, em: agora() }
    } catch (err) {
      log(s, 'nota', err)
      await enviar(s, NOTA_FALHOU).catch(() => {})
    }
  }

  async function tratar(s: Sessao, m: WAMessage) {
    try {
      const id = m.key.id
      if (!id || !s.grupoId || m.key.remoteJid !== s.grupoId || s.enviados.has(id)) return
      const conteudo = normalizeMessageContent(m.message) // desembrulha mensagens temporárias / visualização única
      if (conteudo?.imageMessage) {
        void lerNota(s, m, conteudo.imageMessage) // sem await: não segura a fila
        return
      }
      let texto = conteudo?.conversation ?? conteudo?.extendedTextMessage?.text
      if (!texto) return
      let msgId = id
      const ok = texto.trim().toLowerCase()
      if (ok === '/ok' || ok === 'ok') {
        // confirma a prévia citada ("ok" sem barra só vale citando) ou, com "/ok" solto, a última prévia pendente.
        // Roda o comando da última linha com o id da prévia: o /ok repetido cai no índice único.
        const ctx = conteudo?.extendedTextMessage?.contextInfo
        const linha = comandoDaPrevia(ctx?.quotedMessage?.conversation ?? ctx?.quotedMessage?.extendedTextMessage?.text ?? '')
        if (linha && ctx?.stanzaId) {
          texto = linha
          msgId = ctx.stanzaId
        } else if (ok === 'ok') {
          return // "ok" solto é conversa
        } else if (s.previa && agora() - s.previa.em <= PREVIA_PENDENTE_MS) {
          texto = s.previa.comando
          msgId = s.previa.id
        } else {
          await enviar(s, NOTA_NADA_PENDENTE)
          return
        }
      }

      const ts = Number(m.messageTimestamp) || 0
      const enviadoEm = new Date((ts || agora() / 1000) * 1000)
      const remetente = m.key.fromMe ? jidNormalizedUser(s.sock?.user?.id ?? '') : (m.key.participant ?? '')
      // enviada antes de reconectar = chegou enquanto o bot estava offline
      const recuperada = ts > 0 && ts < s.conectouEm - 2

      const r = await s.service.handle({ msgId, remetente, texto, enviadoEm }, { recuperada })
      if (msgId === s.previa?.id && (!r || r.lancou)) s.previa = undefined // lançada (ou já estava): não há mais o que confirmar
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
      const g = ++s.geracao
      mudar(s, { estado: 'conectando', qr: undefined, codigo: undefined, aviso: undefined }) // síncrono: fecha a porta para o clique duplo
      await s.saida // um desconectar() anterior ainda apagando credenciais não pode apagar as da sessão nova
      try {
        s.grupoId = await deps.grupoDa(contaId)
      } catch (err) {
        // sem o grupo a conta abriria conectada e muda (as mensagens seriam descartadas): melhor falhar à vista
        log(s, 'grupoDa', err)
        mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: 'erro' })
        return
      }
      if (s.geracao !== g) return
      await abrir(s, g)
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
      enviar(s, BOAS_VINDAS).catch((err) => log(s, 'boas-vindas', err)) // não segura a resposta do clique (tem pausa aleatória + envio)
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
      s.geracao++
      s.encerrada = true
      limparTimers(s)
      const sock = s.sock
      s.sock = undefined
      s.cacheGrupos = undefined
      mudar(s, { estado: 'desconectado', qr: undefined, codigo: undefined, aviso: undefined }) // síncrono: cliques seguintes já veem desconectado
      // o logout avisa o WhatsApp, mas pode demorar (rede ruim): não trava o portal nem a sessão seguinte
      if (sock) {
        sock
          .logout()
          .catch(() => {}) // sem sessão aberta o logout falha; tudo bem
          .finally(() => {
            try {
              sock.end(undefined)
            } catch {}
          })
      }
      const saida = Promise.all([deps.apagarAuth(contaId), deps.marcarConectada(contaId, false)]).then(() => undefined)
      s.saida = saida.catch((err) => log(s, 'desconectar', err))
      await saida
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
