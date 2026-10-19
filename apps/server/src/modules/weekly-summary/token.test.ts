import { describe, expect, it } from 'vitest';
import { signUnsubscribeToken } from '../bulk-email/token.js';
import {
  signSummaryUnsubscribeToken,
  summaryUnsubscribeUrls,
  verifySummaryUnsubscribeToken,
} from './token.js';

const secret = 'x'.repeat(32);

describe('weekly summary unsubscribe token', () => {
  it('a token verifies only its own user and group', () => {
    const token = signSummaryUnsubscribeToken(secret, 'user-1', 'group-1');
    expect(verifySummaryUnsubscribeToken(secret, token)).toEqual({
      userId: 'user-1',
      groupId: 'group-1',
    });
    const [, , sig] = token.split('.');
    expect(verifySummaryUnsubscribeToken(secret, `user-1.group-2.${sig}`)).toBeNull();
    expect(verifySummaryUnsubscribeToken('y'.repeat(32), token)).toBeNull();
    expect(verifySummaryUnsubscribeToken(secret, 'garbage')).toBeNull();
    // a bulk email token of the same ids is no weekly summary token
    expect(
      verifySummaryUnsubscribeToken(secret, signUnsubscribeToken(secret, 'user-1', 'group-1')),
    ).toBeNull();
  });

  it('the urls are the page and the one-click endpoint', () => {
    expect(summaryUnsubscribeUrls('https://help.egrant.sk/', 'a.b.c')).toEqual({
      page: 'https://help.egrant.sk/weekly-summary/unsubscribe/a.b.c',
      oneClick: 'https://help.egrant.sk/api/weekly-summary/unsubscribe/a.b.c/one-click',
    });
  });
});
