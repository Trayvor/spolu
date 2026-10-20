import { describe, expect, it } from 'vitest';
import {
  EgrantTicketAreasBodySchema,
  TICKET_AREA_LIMITS,
  TicketAreaRulesBodySchema,
  ticketAreaKey,
} from './ticket-areas.js';

describe('ticketAreaKey', () => {
  it('ignores case, outer whitespace and runs of inner whitespace', () => {
    expect(ticketAreaKey('Projekty')).toBe('projekty');
    expect(ticketAreaKey('  PROJEKTY ')).toBe('projekty');
    expect(ticketAreaKey('Žiadosti   o\tplatbu\n')).toBe('ziadosti o platbu');
    expect(ticketAreaKey('a b')).toBe('a b');
  });

  it('ignores diacritics, also the letters NFD does not split', () => {
    expect(ticketAreaKey('Žiadosť o ľudské zdroje')).toBe('ziadost o ludske zdroje');
    expect(ticketAreaKey('Účtovníctvo')).toBe(ticketAreaKey('uctovnictvo'));
    expect(ticketAreaKey('Ďalšie Ťažkosti')).toBe('dalsie tazkosti');
    expect(ticketAreaKey('Đurđevac Łódź Ørsted')).toBe('durdevac lodz orsted');
    expect(ticketAreaKey('Straße')).toBe('strasse');
    // Composed and decomposed forms are the same key.
    expect(ticketAreaKey('é')).toBe(ticketAreaKey('é'));
  });

  it('drops a leading lower-case "zend" prefix: with a dot, a space or before a capital', () => {
    for (const area of [
      'zend.Projekty',
      'zend Projekty',
      'zend.  Projekty',
      'zend   Projekty',
      '  zend.Projekty  ',
      'zendProjekty',
      'Projekty',
    ]) {
      expect(ticketAreaKey(area), area).toBe('projekty');
    }
    expect(ticketAreaKey('zend.Žiadosti o platbu')).toBe('ziadosti o platbu');
  });

  it('keeps "zend" that is not that prefix', () => {
    // Upper-case is not the prefix.
    expect(ticketAreaKey('Zend.Projekty')).toBe('zend.projekty');
    expect(ticketAreaKey('ZEND Projekty')).toBe('zend projekty');
    // A word that only starts with "zend".
    expect(ticketAreaKey('zendesk')).toBe('zendesk');
    // Nothing after it: the area is "zend" itself.
    expect(ticketAreaKey('zend')).toBe('zend');
    expect(ticketAreaKey('zend.')).toBe('zend.');
    // Not at the start.
    expect(ticketAreaKey('Projekty zend.X')).toBe('projekty zend.x');
    // Only one prefix is dropped.
    expect(ticketAreaKey('zend.zend.Projekty')).toBe('zend.projekty');
  });

  it('is the same on both sides: a prefixed table row matches a plain ticket area', () => {
    expect(ticketAreaKey('zend.Projekty')).toBe(ticketAreaKey('projekty '));
    expect(ticketAreaKey('zend Účty')).toBe(ticketAreaKey('zend.ucty'));
  });

  it('keys whitespace-only text as empty', () => {
    expect(ticketAreaKey('   ')).toBe('');
    expect(ticketAreaKey('')).toBe('');
  });
});

describe('the table bodies', () => {
  const id = 'u_0123456789abcdef';

  it('takes up to the row limit, refuses an empty area and an empty key', () => {
    const rows = (n: number) => Array.from({ length: n }, () => ({ area: 'A', userId: id }));
    expect(
      TicketAreaRulesBodySchema.safeParse({ rules: rows(TICKET_AREA_LIMITS.rows) }).success,
    ).toBe(true);
    expect(
      TicketAreaRulesBodySchema.safeParse({ rules: rows(TICKET_AREA_LIMITS.rows + 1) }).success,
    ).toBe(false);
    expect(
      TicketAreaRulesBodySchema.safeParse({ rules: [{ area: '  ', userId: id }] }).success,
    ).toBe(false);
    expect(
      TicketAreaRulesBodySchema.safeParse({ rules: [{ area: 'x'.repeat(201), userId: id }] })
        .success,
    ).toBe(false);
  });

  it('the eGrant body lower-cases emails and refuses a bad one', () => {
    const ok = EgrantTicketAreasBodySchema.parse({
      instance_url: 'mesto.egrant.sk',
      areas: [{ area: ' zend.Projekty ', email: ' Jana@Egrant.SK ' }],
    });
    expect(ok.areas).toEqual([{ area: 'zend.Projekty', email: 'jana@egrant.sk' }]);
    expect(
      EgrantTicketAreasBodySchema.safeParse({
        instance_url: 'mesto.egrant.sk',
        areas: [{ area: 'A', email: 'not-an-email' }],
      }).success,
    ).toBe(false);
    expect(EgrantTicketAreasBodySchema.safeParse({ areas: [] }).success).toBe(false);
  });
});
