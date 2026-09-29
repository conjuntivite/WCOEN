import nodemailer from 'nodemailer'

export type OpcoesSmtp = { host: string; port: number; user: string; pass: string; from: string }
export type Transporte = { sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> }
type CriarTransporte = (opcoes: { host: string; port: number; secure: boolean; family: 4; auth: { user: string; pass: string } }) => Transporte
export type Mailer = { enviarRedefinicaoSenha(destino: string, link: string): Promise<void> }

const criarTransportePadrao: CriarTransporte = (opcoes) => nodemailer.createTransport(opcoes) as unknown as Transporte

const assunto = 'WCOEN — redefinição de senha'
const corpoTexto = (link: string) => `Recebemos um pedido para redefinir sua senha.

Abra o link (válido por 1 hora):
${link}

Se não foi você, ignore este e-mail.`
const corpoHtml = (link: string) => `<p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${link}">Redefinir senha</a> (válido por 1 hora)</p><p>Se não foi você, ignore este e-mail.</p>`

export function criarMailer(op: OpcoesSmtp, criarTransporte: CriarTransporte = criarTransportePadrao): Mailer {
  const transporte = criarTransporte({ host: op.host, port: op.port, secure: op.port === 465, family: 4 /* Render não sai por IPv6 (ENETUNREACH) */, auth: { user: op.user, pass: op.pass } })
  return {
    async enviarRedefinicaoSenha(destino, link) {
      await transporte.sendMail({
        from: op.from,
        to: destino,
        subject: assunto,
        text: corpoTexto(link),
        html: corpoHtml(link),
      })
    },
  }
}

// Resend por HTTPS (porta 443): o Render gratuito bloqueia SMTP (25/465/587)
export function criarMailerResend(op: { apiKey: string; from: string }, fetchFn: typeof fetch = fetch): Mailer {
  return {
    async enviarRedefinicaoSenha(destino, link) {
      const res = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${op.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: op.from, to: [destino], subject: assunto, text: corpoTexto(link), html: corpoHtml(link) }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
    },
  }
}
