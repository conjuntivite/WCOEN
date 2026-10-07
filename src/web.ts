import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import QRCode from 'qrcode'
import { criarLimitador, type Conta, type Contas, type ErroCadastro } from './contas'
import type { ContasCorrentes } from './contasCorrentes'
import type { Convites } from './convites'
import { montarIndicadores } from './dashboard'
import type { Mailer } from './mailer'
import { parseSaldo } from './money'
import { intervaloDoMes, mesAtual } from './period'
import { AVISOS_ADMIN, AVISOS_CC, ERROS_ADMIN, ERROS_CC, ERROS_PAINEL, AVISOS_PERFIL, ERROS_PERFIL, SCRIPT_APP, SCRIPT_PAINEL, fragmentoPainel, paginaAdmin, paginaCadastro, paginaContasCorrentes, paginaDashboard, paginaEntrar, paginaEsqueciSenha, paginaPainel, paginaPerfil, paginaRedefinirSenha, passoDe, perfilDe, type CampoCadastro } from './paginas'
import type { Repositorio } from './repo'
import type { Sessoes } from './sessoes'

export type OpcoesWeb = {
  contas: Contas
  sessoes: Sessoes
  convites: Convites
  repo: Repositorio // leituras do dashboard (sempre da própria conta)
  contasCorrentes: ContasCorrentes
  mailer?: Mailer
  adminEmails?: string[] // admins fixos (ADMIN_EMAILS): veem /admin e não são rebaixados pelo menu; os demais admins vêm do papel gravado na conta
  limitador?: ReturnType<typeof criarLimitador>
  cookieSeguro?: boolean // com HTTPS (DOMINIO definido)
  confiarProxy?: boolean // lê o IP de X-Forwarded-For (atrás do Caddy ou do proxy do Render)
  dominio?: string // usado para montar o link de redefinição de senha; sem isso, cairia no Host da requisição, que o cliente pode forjar
}

// arquivos estáticos do Trade UI lidos uma vez: símbolos e ícones do WCOEN (design-system/brand) e fontes (design-system/fonts)
const arquivo = (caminho: string, tipo: string): [Buffer, string] => [readFileSync(new URL(caminho, import.meta.url)), tipo]
const ESTATICOS = new Map<string, [Buffer, string]>([
  ...['wcoen-mark', 'wcoen-mark-reverso', 'wcoen-icon-light', 'wcoen-icon-dark'].map((n) => [`/ds/${n}.svg`, arquivo(`../design-system/brand/wcoen/${n}.svg`, 'image/svg+xml')] as const),
  ...['plus-jakarta-sans', 'space-mono'].map((n) => [`/ds/${n}.woff2`, arquivo(`../design-system/fonts/${n}.woff2`, 'font/woff2')] as const),
])

const CABECALHOS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
}
const MSG_CADASTRO: Record<ErroCadastro, string> = {
  convite_invalido: 'Código de convite inválido.',
  email_invalido: 'E-mail inválido.',
  senha_curta: 'A senha precisa ter ao menos 8 caracteres.',
  email_em_uso: 'Este e-mail já está cadastrado.',
}
const CAMPO_CADASTRO: Record<ErroCadastro, CampoCadastro> = { convite_invalido: 'convite', email_invalido: 'email', email_em_uso: 'email', senha_curta: 'senha' }
const TRINTA_DIAS_S = 30 * 24 * 3600

class HttpErro extends Error {
  constructor(readonly status: number) {
    super(String(status))
  }
}

async function corpoForm(req: IncomingMessage): Promise<URLSearchParams> {
  const partes: Buffer[] = []
  let total = 0
  for await (const p of req) {
    total += (p as Buffer).length
    if (total > 10_000) throw new HttpErro(413)
    partes.push(p as Buffer)
  }
  return new URLSearchParams(Buffer.concat(partes).toString('utf8'))
}

// só aceita POST vindo do próprio site: Origin presente e com o mesmo host da requisição
function origemOk(req: IncomingMessage): boolean {
  const o = req.headers.origin
  if (!o) return false
  try {
    return new URL(o).host === req.headers.host
  } catch {
    return false
  }
}

export function criarWeb(op: OpcoesWeb): Server {
  const { contas, sessoes, convites, contasCorrentes } = op
  const limitador = op.limitador ?? criarLimitador(5, 15 * 60_000)
  const fixos = op.adminEmails ?? []
  const isAdmin = (c: Conta) => fixos.includes(c.email) || c.papel === 'admin'

  const html = (res: ServerResponse, status: number, corpo: string) => {
    res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'text/html; charset=utf-8' })
    res.end(corpo)
  }
  const ir = (res: ServerResponse, para: string, cookie?: string) => {
    res.writeHead(303, { ...CABECALHOS, Location: para, ...(cookie ? { 'Set-Cookie': cookie } : {}) })
    res.end()
  }
  const cookieSessao = (token: string, maxAge: number) => `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${op.cookieSeguro ? '; Secure' : ''}`
  const tokenDe = (req: IncomingMessage) => /(?:^|;\s*)sid=([\w-]+)/.exec(req.headers.cookie ?? '')?.[1]
  // com `dominio` configurado, ignora o Host da requisição (que o cliente pode forjar) e usa sempre o domínio real do site
  const baseUrl = (req: IncomingMessage) => (op.dominio ? `https://${op.dominio}` : `${op.cookieSeguro ? 'https' : 'http'}://${req.headers.host}`)
  const contaDe = async (req: IncomingMessage): Promise<Conta | null> => {
    const t = tokenDe(req)
    return t ? contas.contaDoLogin(t) : null
  }
  // Pega o ÚLTIMO valor de X-Forwarded-For: é o hop mais próximo, escrito pelo proxy confiável na borda
  // (Caddy ou Fly Proxy) — nunca pelo cliente. O primeiro valor pode ser forjado pelo próprio atacante.
  const ipDe = (req: IncomingMessage) => (op.confiarProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim() : '') || req.socket.remoteAddress || '?'

  async function montarFragmento(contaId: string) {
    const conta = await contas.porId(contaId)
    if (!conta) return null
    const visao = sessoes.visao(contaId)
    const grupos = visao.estado === 'conectado' ? await sessoes.grupos(contaId).catch(() => []) : []
    const qrSvg = visao.qr ? await QRCode.toString(visao.qr, { type: 'svg', margin: 1 }) : undefined
    return { passo: passoDe(visao, conta), html: fragmentoPainel({ visao, conta, grupos, qrSvg }) }
  }

  async function tratar(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x')
    const caminho = url.pathname
    const metodo = req.method ?? 'GET'
    // sem login/banco: usado pelo health check do host e pelo auto-ping que mantém o app acordado
    if (metodo === 'GET' && caminho === '/saude') return void res.writeHead(200).end('ok')
    const estatico = metodo === 'GET' ? ESTATICOS.get(caminho) : undefined
    if (estatico) {
      res.writeHead(200, { ...CABECALHOS, 'Content-Type': estatico[1], 'Cache-Control': 'public, max-age=86400' })
      return void res.end(estatico[0])
    }
    if (metodo === 'POST' && !origemOk(req)) throw new HttpErro(403)
    const conta = await contaDe(req)

    if (metodo === 'GET') {
      if (caminho === '/') return ir(res, '/painel')
      if (caminho === '/entrar' || caminho === '/cadastro') {
        if (conta) return ir(res, '/painel')
        return html(res, 200, caminho === '/entrar' ? paginaEntrar() : paginaCadastro())
      }
      if (caminho === '/esqueci-senha') {
        if (conta) return ir(res, '/painel')
        return html(res, 200, paginaEsqueciSenha())
      }
      if (caminho === '/redefinir-senha') {
        return html(res, 200, paginaRedefinirSenha(url.searchParams.get('token') ?? ''))
      }
      if (caminho === '/app.js') {
        res.writeHead(200, { ...CABECALHOS, 'Content-Type': 'text/javascript; charset=utf-8' })
        return void res.end(SCRIPT_APP)
      }
      if (caminho === '/painel.js') {
        res.writeHead(200, { ...CABECALHOS, 'Content-Type': 'text/javascript; charset=utf-8' })
        return void res.end(SCRIPT_PAINEL)
      }
      if (caminho === '/painel') {
        if (!conta) return ir(res, '/entrar')
        const f = (await montarFragmento(conta.id))!
        const chave = url.searchParams.get('erro') ?? ''
        return html(res, 200, paginaPainel(conta.email, f.html, f.passo, Object.hasOwn(ERROS_PAINEL, chave) ? ERROS_PAINEL[chave] : undefined, isAdmin(conta), perfilDe(conta)))
      }
      if (caminho === '/dashboard') {
        if (!conta) return ir(res, '/entrar')
        const agora = new Date()
        const { ano, mes } = mesAtual(agora)
        const leitura = op.repo.leitura(conta.id) // sempre a própria conta; ?conta= é ignorado, até para admin
        // ?cc=apelido filtra por conta corrente; porApelido já é por cliente, então apelido alheio ou inexistente cai em "todas"
        const apelido = url.searchParams.get('cc') ?? ''
        const selecionada = apelido ? await contasCorrentes.doCliente(conta.id).porApelido(apelido) : null
        const [serie, balancete, todas] = await Promise.all([
          leitura.serieMensal(agora, 6, selecionada?.id),
          leitura.balancete(intervaloDoMes(ano, mes), selecionada?.id),
          contasCorrentes.listar(conta.id),
        ])
        return html(res, 200, paginaDashboard(conta.email, montarIndicadores(serie, balancete), isAdmin(conta), perfilDe(conta), todas, selecionada?.apelido ?? ''))
      }
      if (caminho === '/contas-correntes') {
        if (!conta) return ir(res, '/entrar')
        const chaveErro = url.searchParams.get('erro') ?? ''
        const chaveOk = url.searchParams.get('ok') ?? ''
        const mensagem = { erro: Object.hasOwn(ERROS_CC, chaveErro) ? ERROS_CC[chaveErro] : undefined, ok: Object.hasOwn(AVISOS_CC, chaveOk) ? AVISOS_CC[chaveOk] : undefined }
        return html(res, 200, paginaContasCorrentes(conta.email, isAdmin(conta), await contasCorrentes.listar(conta.id), mensagem, perfilDe(conta)))
      }
      if (caminho === '/admin') {
        if (!conta) return ir(res, '/entrar')
        if (!isAdmin(conta)) throw new HttpErro(403)
        const contasAdmin = await contas.listarContas()
        const chaveErro = url.searchParams.get('erro') ?? ''
        const chaveOk = url.searchParams.get('ok') ?? ''
        const mensagem = Object.hasOwn(ERROS_ADMIN, chaveErro) ? ERROS_ADMIN[chaveErro] : Object.hasOwn(AVISOS_ADMIN, chaveOk) ? AVISOS_ADMIN[chaveOk] : undefined
        return html(res, 200, paginaAdmin(conta.email, await convites.listar(), contasAdmin, mensagem, perfilDe(conta), fixos))
      }
      if (caminho === '/perfil') {
        if (!conta) return ir(res, '/entrar')
        const chaveErro = url.searchParams.get('erro') ?? ''
        const chaveOk = url.searchParams.get('ok') ?? ''
        const mensagem = { erro: Object.hasOwn(ERROS_PERFIL, chaveErro) ? ERROS_PERFIL[chaveErro] : undefined, ok: Object.hasOwn(AVISOS_PERFIL, chaveOk) ? AVISOS_PERFIL[chaveOk] : undefined }
        return html(res, 200, paginaPerfil(conta, isAdmin(conta) ? 'admin' : 'usuario', sessoes.visao(conta.id).estado, mensagem))
      }
      if (caminho === '/painel/eventos') {
        if (!conta) throw new HttpErro(401)
        res.writeHead(200, { ...CABECALHOS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
        let fila: Promise<unknown> = Promise.resolve()
        const enviar = () => {
          fila = fila
            .then(async () => {
              const f = await montarFragmento(conta.id)
              if (f && !res.writableEnded) res.write(`data: ${JSON.stringify(f)}\n\n`) // JSON não tem quebra de linha crua
            })
            .catch((err) => console.error('sse:', err instanceof Error ? err.message : err))
        }
        const cancelar = sessoes.assinar(conta.id, enviar) // sempre a conta do cookie
        const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
        req.on('close', () => {
          clearInterval(ping)
          cancelar()
        })
        return
      }
      throw new HttpErro(404)
    }

    if (metodo !== 'POST') throw new HttpErro(405)
    const f = await corpoForm(req)

    if (caminho === '/entrar') {
      const email = (f.get('email') ?? '').trim().toLowerCase()
      const chaves = [`e:${email}`, `i:${ipDe(req)}`]
      if (chaves.some((k) => limitador.bloqueado(k))) return html(res, 429, paginaEntrar('Muitas tentativas. Aguarde alguns minutos.', email))
      const c = await contas.verificar(email, f.get('senha') ?? '')
      if (c === 'expirada') return html(res, 401, paginaEntrar('Seu acesso expirou. Fale com o administrador.', email))
      if (!c) {
        chaves.forEach((k) => limitador.falhou(k))
        return html(res, 401, paginaEntrar('E-mail ou senha incorretos.', email))
      }
      limitador.limpar(chaves[0])
      return ir(res, '/painel', cookieSessao(await contas.criarLogin(c.id), TRINTA_DIAS_S))
    }

    if (caminho === '/cadastro') {
      const chaveIp = `i:${ipDe(req)}`
      const emailDigitado = (f.get('email') ?? '').trim()
      if (limitador.bloqueado(chaveIp)) return html(res, 429, paginaCadastro('Muitas tentativas. Aguarde alguns minutos.', undefined, emailDigitado))
      const r = await contas.cadastrar(emailDigitado, f.get('senha') ?? '', f.get('convite') ?? '')
      if (!r.ok) {
        limitador.falhou(chaveIp)
        return html(res, 400, paginaCadastro(MSG_CADASTRO[r.erro], CAMPO_CADASTRO[r.erro], emailDigitado))
      }
      return ir(res, '/painel', cookieSessao(await contas.criarLogin(r.conta.id), TRINTA_DIAS_S))
    }

    if (caminho === '/esqueci-senha') {
      const email = (f.get('email') ?? '').trim().toLowerCase()
      // chave de IP própria (`fi:`), não `i:` — senão um IP já bloqueado em /entrar (senha errada) ficaria
      // impedido de pedir "esqueci minha senha", que é justamente o caminho de recuperação nesse caso
      const chaves = [`f:${email}`, `fi:${ipDe(req)}`]
      if (!chaves.some((k) => limitador.bloqueado(k))) {
        chaves.forEach((k) => limitador.falhou(k))
        // fire-and-forget: se isso fosse `await`ado, o tempo de resposta variaria entre "conta existe" (DELETE+INSERT
        // no Postgres) e "não existe" (nada) — um timing oracle que revelaria se o e-mail está cadastrado, mesmo com
        // a resposta idêntica nos dois casos. Devolve a resposta genérica na hora e termina o trabalho depois.
        void (async () => {
          const c = await contas.porEmail(email)
          if (!c) return
          const token = await contas.criarRedefinicao(c.id)
          const link = `${baseUrl(req)}/redefinir-senha?token=${token}`
          if (op.mailer) await op.mailer.enviarRedefinicaoSenha(c.email, link)
          else console.log(`[mailer] SMTP não configurado. Link de redefinição para ${c.email}: ${link}`)
        })().catch((err) => console.error('esqueci-senha:', err instanceof Error ? err.message : err))
      }
      return html(res, 200, paginaEsqueciSenha(true))
    }

    if (caminho === '/redefinir-senha') {
      const token = f.get('token') ?? ''
      const senha = f.get('senha') ?? ''
      if (senha.length < 8) return html(res, 400, paginaRedefinirSenha(token, 'A senha precisa ter ao menos 8 caracteres.'))
      const contaId = await contas.consumirRedefinicao(token)
      const c = contaId ? await contas.porId(contaId) : null
      if (!c) return html(res, 400, paginaRedefinirSenha(token, 'Link inválido ou expirado. Solicite um novo link.'))
      await contas.redefinirSenha(c.email, senha)
      return ir(res, '/painel', cookieSessao(await contas.criarLogin(contaId!), TRINTA_DIAS_S))
    }

    if (caminho === '/sair') {
      const t = tokenDe(req)
      if (t) await contas.encerrarLogin(t)
      return ir(res, '/entrar', cookieSessao('', 0))
    }

    if (!conta) return ir(res, '/entrar')

    if (caminho === '/perfil') {
      await contas.definirPerfil(conta.id, { nome: f.get('nome') ?? '', cor: f.get('cor') ?? '', icone: f.get('icone') ?? '' })
      return ir(res, '/perfil?ok=salvo')
    }
    if (caminho === '/perfil/senha') {
      const chave = `p:${conta.id}`
      if (limitador.bloqueado(chave)) return ir(res, '/perfil?erro=limite')
      const nova = f.get('nova') ?? ''
      if (nova !== (f.get('confirmacao') ?? '')) return ir(res, '/perfil?erro=confirmacao')
      const r = await contas.trocarSenha(conta.id, f.get('atual') ?? '', nova)
      if (r !== 'ok') {
        if (r === 'senha_atual') limitador.falhou(chave)
        return ir(res, `/perfil?erro=${r}`)
      }
      limitador.limpar(chave)
      await contas.encerrarOutrosLogins(conta.id, tokenDe(req)!)
      return ir(res, '/perfil?ok=senha')
    }
    if (caminho === '/perfil/sair-aparelhos') {
      await contas.encerrarOutrosLogins(conta.id, tokenDe(req)!)
      return ir(res, '/perfil?ok=aparelhos')
    }

    if (caminho === '/contas-correntes') {
      const saldo = parseSaldo(f.get('saldo') ?? '')
      if (saldo === null) return ir(res, '/contas-correntes?erro=saldo_invalido')
      const r = await contasCorrentes.criar(conta.id, { apelido: f.get('apelido') ?? '', nome: f.get('nome') ?? '', saldoInicial: saldo })
      return ir(res, r.ok ? '/contas-correntes?ok=criada' : `/contas-correntes?erro=${r.erro}`)
    }
    if (caminho === '/contas-correntes/editar') {
      const saldo = parseSaldo(f.get('saldo') ?? '')
      if (saldo === null) return ir(res, '/contas-correntes?erro=saldo_invalido')
      const r = await contasCorrentes.editar(conta.id, f.get('id') ?? '', { nome: f.get('nome') ?? '', saldoInicial: saldo })
      return ir(res, r === 'ok' ? '/contas-correntes?ok=salva' : `/contas-correntes?erro=${r}`)
    }
    if (caminho === '/contas-correntes/favoritar') {
      const r = await contasCorrentes.favoritar(conta.id, f.get('id') ?? '')
      return ir(res, r === 'ok' ? '/contas-correntes?ok=favorita' : `/contas-correntes?erro=${r}`)
    }
    if (caminho === '/contas-correntes/desativar' || caminho === '/contas-correntes/reativar') {
      const ativar = caminho.endsWith('/reativar')
      const r = await contasCorrentes.definirAtiva(conta.id, f.get('id') ?? '', ativar)
      return ir(res, r === 'ok' ? `/contas-correntes?ok=${ativar ? 'reativada' : 'desativada'}` : `/contas-correntes?erro=${r}`)
    }

    if (caminho === '/painel/conectar') {
      await sessoes.iniciar(conta.id)
      return ir(res, '/painel')
    }
    if (caminho === '/painel/parear') {
      try {
        await sessoes.parear(conta.id, f.get('telefone') ?? '')
      } catch (err) {
        if ((err as Error).message === 'telefone_invalido') return ir(res, '/painel?erro=telefone')
        if ((err as Error).message !== 'indisponivel') throw err
      }
      return ir(res, '/painel')
    }
    if (caminho === '/painel/grupo') {
      try {
        await sessoes.definirGrupo(conta.id, f.get('grupo') ?? '')
      } catch (err) {
        if ((err as Error).message === 'grupo_invalido') return ir(res, '/painel?erro=grupo')
        if ((err as Error).message !== 'nao_conectado') throw err
      }
      return ir(res, '/painel')
    }
    if (caminho === '/painel/desconectar') {
      await sessoes.desconectar(conta.id)
      return ir(res, '/painel')
    }
    if (caminho === '/admin/convites') {
      if (!isAdmin(conta)) throw new HttpErro(403)
      await convites.criar(conta.id, f.get('nota') ?? undefined)
      return ir(res, '/admin')
    }
    if (caminho === '/admin/convites/revogar') {
      if (!isAdmin(conta)) throw new HttpErro(403)
      await convites.revogar(f.get('id') ?? '')
      return ir(res, '/admin')
    }
    if (caminho === '/admin/contas/desativar') {
      if (!isAdmin(conta)) throw new HttpErro(403)
      const id = f.get('id') ?? ''
      await sessoes.desconectar(id)
      await contas.definirAtiva(id, false)
      return ir(res, '/admin')
    }
    if (caminho === '/admin/contas/reativar') {
      if (!isAdmin(conta)) throw new HttpErro(403)
      await contas.definirAtiva(f.get('id') ?? '', true)
      return ir(res, '/admin')
    }
    if (caminho === '/admin/contas/redefinir') {
      if (!isAdmin(conta)) throw new HttpErro(403)
      const alvo = await contas.porId(f.get('id') ?? '')
      if (alvo) {
        const token = await contas.criarRedefinicao(alvo.id)
        const link = `${baseUrl(req)}/redefinir-senha?token=${token}`
        if (op.mailer) op.mailer.enviarRedefinicaoSenha(alvo.email, link).catch((err) => console.error('mailer:', err instanceof Error ? err.message : err))
        else console.log(`[mailer] SMTP não configurado. Link de redefinição para ${alvo.email}: ${link}`)
      }
      return ir(res, '/admin?ok=redefinicao')
    }
    if (caminho === '/admin/contas/papel') {
      if (!isAdmin(conta)) throw new HttpErro(403)
      const id = f.get('id') ?? ''
      const alvo = (await contas.listarContas()).find((c) => c.id === id) // porId esconde contas vencidas/desativadas, justamente as que o admin precisa renovar
      if (!alvo) return ir(res, '/admin')
      if (alvo.id === conta.id) return ir(res, '/admin?erro=proprio')
      if (fixos.includes(alvo.email)) return ir(res, '/admin?erro=fixo')
      const escolha = f.get('papel')
      if (escolha !== 'admin' && escolha !== 'usuario' && escolha !== 'validade') return ir(res, '/admin')
      const ate = f.get('ate') ?? ''
      if (escolha === 'validade' && !ate) return ir(res, '/admin?erro=data')
      const r = await contas.definirPapel(id, escolha === 'admin' ? 'admin' : 'usuario', escolha === 'validade' ? ate : undefined)
      return ir(res, r === 'ok' ? '/admin?ok=papel' : '/admin?erro=data')
    }
    throw new HttpErro(404)
  }

  return createServer((req, res) => {
    tratar(req, res).catch((err) => {
      const status = err instanceof HttpErro ? err.status : 500
      if (status === 500) console.error('web:', err instanceof Error ? err.message : err)
      if (res.headersSent) return void res.end()
      res.writeHead(status, { ...CABECALHOS, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(status === 500 ? 'Erro interno' : String(status))
    })
  })
}
