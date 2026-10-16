import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSmtpSender } from './smtp-sender.js';

describe('createSmtpSender transport options', () => {
  afterEach(() => vi.restoreAllMocks());

  function optionsFor(opts: Parameters<typeof createSmtpSender>[0]): unknown {
    const spy = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail: vi.fn() } as never);
    createSmtpSender(opts);
    return spy.mock.calls[0]![0];
  }

  it('passes secure and auth through', () => {
    expect(
      optionsFor({
        host: 'smtp.elasticemail.com',
        port: 465,
        secure: true,
        auth: { user: 'u', pass: 'p' },
        from: 'a@b.c',
      }),
    ).toEqual({
      host: 'smtp.elasticemail.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });
  });

  it('stays plain and unauthenticated for Mailpit', () => {
    const o = optionsFor({ host: '127.0.0.1', port: 1025, secure: false, from: 'a@b.c' });
    expect(o).toEqual({ host: '127.0.0.1', port: 1025, secure: false });
  });
});

describe('createSmtpSender messages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the transactional smtp sender adds IsTransactional: True', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    await createSmtpSender({ host: 'h', port: 25, from: 'a@b.c' }).send({
      to: ['x@example.com'],
      subject: 'Code',
      html: '<p>1</p>',
      text: '1',
    });
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ headers: { IsTransactional: 'True' } });
  });
});
