import nodemailer from 'nodemailer'

export type OpcoesSmtp = { host: string; port: number; user: string; pass: string; from: string }
export type Transporte = { sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> }
type CriarTransporte = (opcoes: { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }) => Transporte
export type Mailer = { enviarRedefinicaoSenha(destino: string, link: string): Promise<void> }

const criarTransportePadrao: CriarTransporte = (opcoes) => nodemailer.createTransport(opcoes) as unknown as Transporte

export function criarMailer(op: OpcoesSmtp, criarTransporte: CriarTransporte = criarTransportePadrao): Mailer {
  const transporte = criarTransporte({ host: op.host, port: op.port, secure: op.port === 465, auth: { user: op.user, pass: op.pass } })
  return {
    async enviarRedefinicaoSenha(destino, link) {
      await transporte.sendMail({
        from: op.from,
        to: destino,
        subject: 'WCOEN — redefinição de senha',
        text: `Recebemos um pedido para redefinir sua senha.\n\nAbra o link (válido por 1 hora):\n${link}\n\nSe não foi você, ignore este e-mail.`,
        html: `<p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${link}">Redefinir senha</a> (válido por 1 hora)</p><p>Se não foi você, ignore este e-mail.</p>`,
      })
    },
  }
}
