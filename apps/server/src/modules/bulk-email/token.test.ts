import { describe, expect, it } from 'vitest';
import { signUnsubscribeToken, unsubscribeUrls, verifyUnsubscribeToken } from './token.js';

const secret = 's'.repeat(32);
const userId = 'Xk3bD9fQ2mZ7';
const campaignId = '0b8f2a8e-4f5d-4c1e-9a77-1f2e3d4c5b6a';

describe('unsubscribe token', () => {
  it('round-trips', () => {
    const token = signUnsubscribeToken(secret, userId, campaignId);
    expect(token.startsWith(`${userId}.${campaignId}.`)).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(verifyUnsubscribeToken(secret, token)).toEqual({ userId, campaignId });
  });

  it('round-trips the test campaign id', () => {
    const token = signUnsubscribeToken(secret, userId, 'test');
    expect(verifyUnsubscribeToken(secret, token)).toEqual({ userId, campaignId: 'test' });
  });

  it('a changed user id, campaign id or signature → null', () => {
    const token = signUnsubscribeToken(secret, userId, campaignId);
    const [, , sig] = token.split('.');
    expect(verifyUnsubscribeToken(secret, `other.${campaignId}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${userId}.test.${sig}`)).toBeNull();
    const flipped = sig!.startsWith('A') ? `B${sig!.slice(1)}` : `A${sig!.slice(1)}`;
    expect(verifyUnsubscribeToken(secret, `${userId}.${campaignId}.${flipped}`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${userId}.${campaignId}.${sig}x`)).toBeNull();
  });

  it('a token signed with another secret → null', () => {
    const token = signUnsubscribeToken('o'.repeat(32), userId, campaignId);
    expect(verifyUnsubscribeToken(secret, token)).toBeNull();
  });

  it('malformed (two parts, four parts, empty parts, empty) → null', () => {
    const sig = signUnsubscribeToken(secret, userId, campaignId).split('.')[2]!;
    expect(verifyUnsubscribeToken(secret, `${userId}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${userId}.${campaignId}.${sig}.x`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, `.${campaignId}.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${userId}..${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${userId}.${campaignId}.`)).toBeNull();
    expect(verifyUnsubscribeToken(secret, '')).toBeNull();
  });

  it('unsubscribeUrls builds the page and the one-click URL', () => {
    const token = signUnsubscribeToken(secret, userId, campaignId);
    expect(unsubscribeUrls('https://spolu.egrant.sk/', token)).toEqual({
      page: `https://spolu.egrant.sk/unsubscribe/${token}`,
      oneClick: `https://spolu.egrant.sk/api/bulk-email/unsubscribe/${token}/one-click`,
    });
    expect(unsubscribeUrls('http://localhost:3000', token).page).toBe(
      `http://localhost:3000/unsubscribe/${token}`,
    );
  });
});
