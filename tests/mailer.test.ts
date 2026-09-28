import { describe, expect, it, vi } from 'vitest'
import { criarMailer } from '../src/mailer'

describe('criarMailer', () => {
  const op = { host: 'smtp.exemplo.com', port: 587, user: 'bot@exemplo.com', pass: 'segredo', from: 'no-reply@exemplo.com' }

  it('monta o transporte com host/porta/credenciais; porta 465 liga secure', () => {
    const criarTransporte = vi.fn(() => ({ sendMail: vi.fn() }))
    criarMailer(op, criarTransporte)
    expect(criarTransporte).toHaveBeenCalledWith({ host: 'smtp.exemplo.com', port: 587, secure: false, auth: { user: 'bot@exemplo.com', pass: 'segredo' } })

    criarMailer({ ...op, port: 465 }, criarTransporte)
    expect(criarTransporte).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true }))
  })

  it('enviarRedefinicaoSenha manda de/para, assunto e o link no texto e no html', async () => {
    const sendMail = vi.fn()
    const mailer = criarMailer(op, () => ({ sendMail }))
    await mailer.enviarRedefinicaoSenha('ana@x.com', 'https://app.exemplo.com/redefinir-senha?token=abc')
    expect(sendMail).toHaveBeenCalledTimes(1)
    const [msg] = sendMail.mock.calls[0]
    expect(msg.from).toBe('no-reply@exemplo.com')
    expect(msg.to).toBe('ana@x.com')
    expect(msg.subject).toContain('redefinição de senha')
    expect(msg.text).toContain('https://app.exemplo.com/redefinir-senha?token=abc')
    expect(msg.html).toContain('href="https://app.exemplo.com/redefinir-senha?token=abc"')
  })
})
