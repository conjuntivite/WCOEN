import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarSessoes, type DepsSessoes } from '../src/sessoes'
import { BOAS_VINDAS, recuperados } from '../src/presentation'
import type { Mensagem, Resposta } from '../src/service'

class SocketFalso {
  ouvintes: Record<string, Array<(dados: any) => void>> = {}
  ev = { on: (evento: string, f: (dados: any) => void) => { (this.ouvintes[evento] ??= []).push(f) } }
  user = { id: '5511999999999:1@s.whatsapp.net' }
  enviadas: { jid: string; texto: string }[] = []
  sendMessage = vi.fn(async (jid: string, c: { text: string }) => {
    this.enviadas.push({ jid, texto: c.text })
    return { key: { id: `saida${this.enviadas.length}` } }
  })
  groupFetchAllParticipating = vi.fn(async () => ({
    'g1@g.us': { id: 'g1@g.us', subject: 'Casa' },
    'g2@g.us': { id: 'g2@g.us', subject: 'Amigos' },
  }))
  requestPairingCode = vi.fn(async (_telefone: string) => 'ABCD1234')
  logout = vi.fn(async () => {})
  end = vi.fn((_erro?: Error) => {})
  emitir(evento: string, dados: unknown) {
    for (const f of this.ouvintes[evento] ?? []) f(dados)
  }
}

const AGORA_S = 1_700_000_000 // instante do "relógio" dos testes, em segundos
const fecha = (codigo: number) => ({ error: { output: { statusCode: codigo } } })
let n = 0
const upsert = (jid: string, texto: string, ts = AGORA_S + 10, id = `id${++n}`) => ({
  type: 'notify',
  messages: [{ key: { id, remoteJid: jid, fromMe: false, participant: 'u@s.whatsapp.net' }, message: { conversation: texto }, messageTimestamp: ts }],
})

function montar(extra: Partial<DepsSessoes> = {}) {
  const socks: SocketFalso[] = []
  const relogio = { ms: AGORA_S * 1000 }
  const handle = vi.fn(async (_m: Mensagem, _o: { recuperada?: boolean }): Promise<Resposta | null> => ({ texto: 'ok', lancou: false }))
  const grupos = new Map<string, string>()
  const conectadas = new Map<string, boolean>()
  const deps: DepsSessoes = {
    criarAuth: async () => ({ state: {} as never, saveCreds: async () => {} }),
    apagarAuth: vi.fn(async (_id: string) => {}),
    criarSocket: async () => {
      const s = new SocketFalso()
      socks.push(s)
      return s
    },
    criarService: () => ({ handle }),
    grupoDa: async (id) => grupos.get(id),
    salvarGrupo: vi.fn(async (id: string, g: string) => { grupos.set(id, g) }),
    marcarConectada: async (id, v) => { conectadas.set(id, v) },
    dormir: async () => {},
    agora: () => relogio.ms,
    ...extra,
  }
  return { sessoes: criarSessoes(deps), socks, handle, grupos, conectadas, deps, relogio }
}

const abrir = async (m: ReturnType<typeof montar>, conta = 'a', i = 0) => {
  await m.sessoes.iniciar(conta)
  m.socks[i].emitir('connection.update', { connection: 'open' })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('conexão e estados', () => {
  it('iniciar → conectando; QR → aguardando_qr; open → conectado e marcada', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    expect(m.sessoes.visao('a')).toEqual({ estado: 'conectando' })
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'aguardando_qr', qr: 'QR1' })
    m.socks[0].emitir('connection.update', { connection: 'open' })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'conectado' })
    expect(m.conectadas.get('a')).toBe(true)
  })

  it('clique duplo / duas abas: iniciar de novo reaproveita a sessão (um socket só)', async () => {
    const m = montar()
    await Promise.all([m.sessoes.iniciar('a'), m.sessoes.iniciar('a')])
    await m.sessoes.iniciar('a')
    expect(m.socks).toHaveLength(1)
  })

  it('QR não escaneado expira em 2 min: fecha o socket, avisa e ignora o "close" tardio', async () => {
    vi.useFakeTimers()
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'qr_expirado' })
    expect(m.socks[0].end).toHaveBeenCalled()
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(408) })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(1)
    expect(m.sessoes.visao('a').estado).toBe('desconectado')
  })

  it('timeout do próprio Baileys (408) durante o QR também vira "qr_expirado"', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(408) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'qr_expirado' })
  })

  it('código 515 depois do pareamento recria o socket, sem virar erro', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(515) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'conectando' })
    await vi.waitFor(() => expect(m.socks).toHaveLength(2))
    m.socks[1].emitir('connection.update', { connection: 'open' })
    expect(m.sessoes.visao('a').estado).toBe('conectado')
  })

  it('loggedOut (401): apaga as credenciais, desmarca e não reconecta', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(401) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'sessao_encerrada' })
    expect(m.deps.apagarAuth).toHaveBeenCalledWith('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(m.conectadas.get('a')).toBe(false)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(1)
  })

  it('connectionReplaced (440): desconectado, sem retry automático', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(440) })
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'sessao_assumida' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(1)
  })

  it('queda de rede: mostra "conectando" e reconecta com backoff', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(500) })
    expect(m.sessoes.visao('a').estado).toBe('conectando')
    expect(m.socks).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.socks).toHaveLength(2)
  })

  it('MAX_SESSOES: a excedente fica desconectada com aviso "servidor_lotado"', async () => {
    const m = montar({ maxSessoes: 1 })
    await m.sessoes.iniciar('a')
    await m.sessoes.iniciar('b')
    expect(m.sessoes.visao('b')).toEqual({ estado: 'desconectado', aviso: 'servidor_lotado' })
    expect(m.socks).toHaveLength(1)
  })

  it('falha ao abrir uma conta (ex.: CHAVE_CRIPTO errada) fica isolada nela', async () => {
    const m = montar({
      criarAuth: async (id) => {
        if (id === 'a') throw new Error('CHAVE_CRIPTO não confere')
        return { state: {} as never, saveCreds: async () => {} }
      },
    })
    await m.sessoes.iniciar('a')
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado', aviso: 'erro' })
    await m.sessoes.iniciar('b')
    expect(m.sessoes.visao('b').estado).toBe('conectando')
    expect(m.socks).toHaveLength(1)
  })
})

describe('mensagens', () => {
  it('sem grupo escolhido nada é processado; depois de escolher, só o grupo escolhido', async () => {
    const m = montar()
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'mercado 10'))
    await m.sessoes.definirGrupo('a', 'g1@g.us')
    expect(m.handle).not.toHaveBeenCalled() // a mensagem anterior à escolha foi ignorada
    m.socks[0].emitir('messages.upsert', upsert('g2@g.us', 'outro grupo'))
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'luz 20', undefined, 'certa'))
    await vi.waitFor(() => expect(m.handle).toHaveBeenCalledTimes(1))
    expect(m.handle.mock.calls[0][0]).toMatchObject({ msgId: 'certa', texto: 'luz 20' })
  })

  it('grupo salvo é carregado ao abrir e a resposta vai para o grupo', async () => {
    const m = montar()
    m.grupos.set('a', 'g1@g.us')
    m.handle.mockResolvedValue({ texto: 'olá', lancou: false })
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'oi'))
    await vi.waitFor(() => expect(m.socks[0].enviadas).toEqual([{ jid: 'g1@g.us', texto: 'olá' }]))
  })

  it('anti-loop: o eco da própria resposta não é tratado de novo', async () => {
    const m = montar()
    m.grupos.set('a', 'g1@g.us')
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'oi'))
    await vi.waitFor(() => expect(m.socks[0].enviadas).toHaveLength(1))
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'ok', undefined, 'saida1'))
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'fim', undefined, 'sentinela'))
    await vi.waitFor(() => expect(m.handle).toHaveBeenCalledTimes(2))
    expect(m.handle.mock.calls.map((c) => c[0].msgId)).not.toContain('saida1')
  })

  it('mensagem anterior à conexão é "recuperada"; se lançou, só um resumo depois de 5 s', async () => {
    vi.useFakeTimers()
    const m = montar()
    m.grupos.set('a', 'g1@g.us')
    m.handle.mockResolvedValue({ texto: 'x', lancou: true })
    await abrir(m)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'mercado 10', AGORA_S - 1000, 'velha'))
    await vi.advanceTimersByTimeAsync(0)
    expect(m.handle).toHaveBeenCalledWith(expect.objectContaining({ msgId: 'velha' }), { recuperada: true })
    expect(m.socks[0].enviadas).toEqual([])
    await vi.advanceTimersByTimeAsync(5000)
    expect(m.socks[0].enviadas.map((e) => e.texto)).toEqual([recuperados(1)])
  })

  it('erro ao tratar uma mensagem fica isolado: outra conta segue funcionando', async () => {
    const boa = vi.fn(async (): Promise<Resposta | null> => ({ texto: 'ok', lancou: false }))
    const m = montar({ criarService: (id) => ({ handle: id === 'a' ? vi.fn().mockRejectedValue(new Error('boom')) : boa }) })
    m.grupos.set('a', 'g1@g.us')
    m.grupos.set('b', 'g1@g.us')
    await abrir(m, 'a', 0)
    await abrir(m, 'b', 1)
    m.socks[0].emitir('messages.upsert', upsert('g1@g.us', 'x'))
    m.socks[1].emitir('messages.upsert', upsert('g1@g.us', 'y'))
    await vi.waitFor(() => expect(boa).toHaveBeenCalled())
    expect(console.error).toHaveBeenCalled()
    expect(m.sessoes.visao('a').estado).toBe('conectado')
  })
})

describe('grupos', () => {
  it('lista em ordem alfabética e usa cache de 60 s', async () => {
    const m = montar()
    await abrir(m)
    expect(await m.sessoes.grupos('a')).toEqual([{ id: 'g2@g.us', nome: 'Amigos' }, { id: 'g1@g.us', nome: 'Casa' }])
    await m.sessoes.grupos('a')
    expect(m.socks[0].groupFetchAllParticipating).toHaveBeenCalledTimes(1)
    m.relogio.ms += 61_000
    await m.sessoes.grupos('a')
    expect(m.socks[0].groupFetchAllParticipating).toHaveBeenCalledTimes(2)
  })

  it('não conectada: lista vazia', async () => {
    expect(await montar().sessoes.grupos('a')).toEqual([])
  })

  it('definirGrupo salva e manda a boas-vindas ao grupo', async () => {
    const m = montar()
    await abrir(m)
    await m.sessoes.definirGrupo('a', 'g1@g.us')
    expect(m.deps.salvarGrupo).toHaveBeenCalledWith('a', 'g1@g.us', 'Casa')
    expect(m.socks[0].enviadas).toEqual([{ jid: 'g1@g.us', texto: BOAS_VINDAS }])
  })

  it('id de grupo forjado (fora da lista da conta) é recusado sem salvar nem enviar', async () => {
    const m = montar()
    await abrir(m)
    await expect(m.sessoes.definirGrupo('a', 'invasor@g.us')).rejects.toThrow('grupo_invalido')
    expect(m.deps.salvarGrupo).not.toHaveBeenCalled()
    expect(m.socks[0].enviadas).toEqual([])
  })

  it('definirGrupo sem estar conectada é recusado', async () => {
    await expect(montar().sessoes.definirGrupo('a', 'g1@g.us')).rejects.toThrow('nao_conectado')
  })
})

describe('código de pareamento', () => {
  it('só com o QR pronto; limpa o número; devolve o código e o expõe na visão', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    await expect(m.sessoes.parear('a', '5511999999999')).rejects.toThrow('indisponivel') // ainda sem QR
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    expect(await m.sessoes.parear('a', '+55 (11) 99999-9999')).toBe('ABCD1234')
    expect(m.socks[0].requestPairingCode).toHaveBeenCalledWith('5511999999999')
    expect(m.sessoes.visao('a').codigo).toBe('ABCD1234')
  })

  it('recusa telefone com menos de 10 ou mais de 15 dígitos', async () => {
    const m = montar()
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    await expect(m.sessoes.parear('a', '123')).rejects.toThrow('telefone_invalido')
    await expect(m.sessoes.parear('a', '1'.repeat(16))).rejects.toThrow('telefone_invalido')
  })
})

describe('desconectar, assinar, reabrir, encerrar', () => {
  it('desconectar faz logout, apaga credenciais, desmarca e volta a desconectado', async () => {
    const m = montar()
    await abrir(m)
    await m.sessoes.desconectar('a')
    expect(m.socks[0].logout).toHaveBeenCalled()
    expect(m.deps.apagarAuth).toHaveBeenCalledWith('a')
    expect(m.conectadas.get('a')).toBe(false)
    expect(m.sessoes.visao('a')).toEqual({ estado: 'desconectado' })
    await m.sessoes.iniciar('a') // dá para conectar de novo
    expect(m.socks).toHaveLength(2)
  })

  it('assinar recebe a visão atual e as mudanças da própria conta; cancelar para de receber', async () => {
    const m = montar()
    const a = vi.fn()
    const b = vi.fn()
    const cancelarA = m.sessoes.assinar('a', a)
    m.sessoes.assinar('b', b)
    expect(a).toHaveBeenCalledWith({ estado: 'desconectado' })
    await m.sessoes.iniciar('a')
    m.socks[0].emitir('connection.update', { qr: 'QR1' })
    expect(a).toHaveBeenLastCalledWith({ estado: 'aguardando_qr', qr: 'QR1' })
    expect(b).toHaveBeenCalledTimes(1) // só a chamada inicial: eventos de 'a' não vazam para 'b'
    cancelarA()
    m.socks[0].emitir('connection.update', { connection: 'open' })
    expect(a).toHaveBeenCalledTimes(3)
  })

  it('reabrir abre as contas uma a uma, com intervalo entre elas', async () => {
    const dormir = vi.fn(async (_ms: number) => {})
    const m = montar({ dormir })
    await m.sessoes.reabrir(['a', 'b'], 3000)
    expect(m.socks).toHaveLength(2)
    expect(dormir).toHaveBeenCalledWith(3000)
  })

  it('encerrar fecha todos os sockets sem reconectar', async () => {
    vi.useFakeTimers()
    const m = montar()
    await abrir(m, 'a', 0)
    await m.sessoes.iniciar('b')
    await m.sessoes.encerrar()
    expect(m.socks[0].end).toHaveBeenCalled()
    expect(m.socks[1].end).toHaveBeenCalled()
    m.socks[0].emitir('connection.update', { connection: 'close', lastDisconnect: fecha(500) })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(m.socks).toHaveLength(2)
  })
})
