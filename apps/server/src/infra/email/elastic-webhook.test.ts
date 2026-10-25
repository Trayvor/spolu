import { describe, expect, it } from 'vitest';
import {
  ELASTIC_SIGNATURE_SKEW_SECONDS,
  signElasticWebhook,
  verifyElasticWebhook,
} from './elastic-webhook.js';

// The test vectors of Elastic's own docs (elasticemail-examples, docs/webhooks.md).
const SECRET = 'whsec_test_secret';
const TS = 1790000000;
const POST_BODY = '{"status":"Sent","to":"ann@example.com"}';
const POST_SIG = '9e2169fcd0a96f634795bb9eac9c985574a7dcf9741b4c863cb4a75bdea3b465';
const GET_SIG = 'e1d554a00233bcf7b00d296348cd3f4390fdd578fe606789b3067b0487442b52';

const request = (over: Partial<Parameters<typeof verifyElasticWebhook>[0]> = {}) => ({
  secret: SECRET,
  timestamp: String(TS),
  signature: `v1=${POST_SIG}`,
  method: 'POST',
  target: '/webhook?v=2',
  rawBody: POST_BODY,
  nowSeconds: TS,
  ...over,
});

describe('Elastic webhook signature', () => {
  it('signs like the documented test vectors', () => {
    expect(signElasticWebhook(SECRET, TS, 'POST', '/webhook?v=2', POST_BODY)).toBe(POST_SIG);
    expect(
      signElasticWebhook(SECRET, TS, 'GET', '/webhook?status=Sent&to=ann%40example.com', ''),
    ).toBe(GET_SIG);
  });

  it('accepts the documented POST vector', () => {
    expect(verifyElasticWebhook(request())).toBe(true);
  });

  it('accepts when any v1= entry of a comma-separated list matches', () => {
    expect(
      verifyElasticWebhook(request({ signature: `v1=${'0'.repeat(64)}, v1=${POST_SIG}` })),
    ).toBe(true);
  });

  it.each([
    ['a missing signature', { signature: undefined }],
    ['a missing timestamp', { timestamp: undefined }],
    ['a non-numeric timestamp', { timestamp: '17900000x0' }],
    ['another body', { rawBody: POST_BODY.replace('Sent', 'Opened') }],
    ['another target', { target: '/webhook' }],
    ['another method', { method: 'GET' }],
    ['another secret', { secret: 'whsec_other_secret' }],
    ['no v1= prefix', { signature: POST_SIG }],
    ['a short signature', { signature: `v1=${POST_SIG.slice(0, 10)}` }],
    ['a stale timestamp', { nowSeconds: TS + ELASTIC_SIGNATURE_SKEW_SECONDS + 1 }],
    ['a future timestamp', { nowSeconds: TS - ELASTIC_SIGNATURE_SKEW_SECONDS - 1 }],
  ])('rejects %s', (_name, over) => {
    expect(verifyElasticWebhook(request(over))).toBe(false);
  });

  it('accepts a timestamp exactly at the edge of the 5-minute window', () => {
    expect(ELASTIC_SIGNATURE_SKEW_SECONDS).toBe(300);
    expect(verifyElasticWebhook(request({ nowSeconds: TS + 300 }))).toBe(true);
    expect(verifyElasticWebhook(request({ nowSeconds: TS - 300 }))).toBe(true);
  });
});
