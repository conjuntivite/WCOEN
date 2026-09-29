import { describe, expect, it, vi } from 'vitest'
import { criarMailer, criarMailerResend } from '../src/mailer'

describe('criarMailer', () => {
  const op = { host: 'smtp.exemplo.com', port: 587, user: 'bot@exemplo.com', pass: 'segredo', from: 'no-reply@exemplo.com' }

  it('monta o transporte com host/porta/credenciais; porta 465 liga secure', () => {
    const criarTransporte = vi.fn(() => ({ sendMail: vi.fn() }))
    criarMailer(op, criarTransporte)
    expect(criarTransporte).toHaveBeenCalledWith({ host: 'smtp.exemplo.com', port: 587, secure: false, family: 4, auth: { user: 'bot@exemplo.com', pass: 'segredo' } })

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

describe('criarMailerResend', () => {
  it('posta na API com Bearer, de/para e o link', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }))
    await criarMailerResend({ apiKey: 're_x', from: 'WCOEN <a@b.com>' }, fetchFn as never).enviarRedefinicaoSenha('ana@x.com', 'https://app/r?token=abc')
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_x')
    const corpo = JSON.parse(init.body as string)
    expect(corpo).toMatchObject({ from: 'WCOEN <a@b.com>', to: ['ana@x.com'] })
    expect(corpo.html).toContain('https://app/r?token=abc')
  })

  it('falha com o status quando a API recusa (sem vazar a chave)', async () => {
    const fetchFn = vi.fn(async () => new Response('domínio não verificado', { status: 403 }))
    const p = criarMailerResend({ apiKey: 're_segredo', from: 'x' }, fetchFn as never).enviarRedefinicaoSenha('a@b.com', 'l')
    await expect(p).rejects.toThrow(/Resend 403/)
    await expect(p).rejects.not.toThrow(/re_segredo/)
  })
})
