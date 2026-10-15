import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { latestLoginCode } from './mailpit.js';

/** `name=value` pairs of every Set-Cookie in the response, joined as a Cookie header. */
export function cookieHeader(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const cookies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

export function requestCode(
  app: FastifyInstance,
  email: string,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers,
    payload: { email, type: 'sign-in' },
  });
}

export function signIn(app: FastifyInstance, email: string, otp: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    payload: { email, otp },
  });
}

/** Logs `email` in with a code read from Mailpit; returns the Cookie header value. */
export async function loginAs(app: FastifyInstance, email: string): Promise<string> {
  const sent = await requestCode(app, email);
  if (sent.statusCode !== 200) throw new Error(`Sending the code failed: ${sent.body}`);
  const res = await signIn(app, email, await latestLoginCode(email));
  if (res.statusCode !== 200) throw new Error(`Sign-in failed: ${res.body}`);
  return cookieHeader(res);
}
