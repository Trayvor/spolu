import { describe, expect, it } from 'vitest';
import { draftTerms, guardIdentities, maskIdentities, redactContacts } from './draft-terms.js';

describe('draftTerms', () => {
  it('stems Slovak words to six characters and strips diacritics', () => {
    expect(draftTerms(['Rozpočet projektu', 'zmena rozpočtu'])).toEqual([
      'rozpoc',
      'projek',
      'zmena',
    ]);
  });

  it('drops short words and stop words, keeps at most 8, most frequent first', () => {
    const terms = draftTerms([
      'a ako je to s tým, alebo ktorý',
      'žiadosť žiadosť platba faktúra dotácia zmluva termín výzva príloha audit',
    ]);
    expect(terms[0]).toBe('ziados');
    expect(terms).toHaveLength(8);
    expect(terms).not.toContain('alebo');
    expect(terms).not.toContain('ktory');
  });

  it('returns no terms for punctuation only', () => expect(draftTerms(['??? !!'])).toEqual([]));
});

describe('redactContacts', () => {
  it('redacts emails and phone numbers', () => {
    expect(redactContacts('Píšte na jan.novak@firma.sk alebo +421 905 123 456.')).toBe(
      'Píšte na [e-mail] alebo [telefón].',
    );
  });

  it('keeps years and short numbers', () =>
    expect(redactContacts('Výzva 2026, bod 12')).toBe('Výzva 2026, bod 12'));
});

describe('maskIdentities', () => {
  it('masks full names, name parts and the client name, ignoring case and diacritics', () => {
    expect(
      maskIdentities('Pán Novák z obce Horna Lehota, Ján NOVAK píše', {
        names: ['Ján Novák'],
        clients: ['Obec Horná Lehota'],
      }),
    ).toBe('Pán [meno] z obce [klient], [meno] [meno] píše');
  });

  it('does not mask inside other words', () =>
    expect(maskIdentities('Novákovci, Janko', { names: ['Ján Novák'], clients: [] })).toBe(
      'Novákovci, Janko',
    ));

  it('masks a full name of short parts and leaves its own tokens alone', () => {
    expect(maskIdentities('Li Na a [meno]', { names: ['Li Na', 'Meno'], clients: [] })).toBe(
      '[meno] a [meno]',
    );
  });

  it('leaves the text alone without identities', () =>
    expect(maskIdentities('Dobrý deň', { names: [], clients: [] })).toBe('Dobrý deň'));
});

describe('guardIdentities', () => {
  it('also catches inflected forms in a reply', () => {
    const out = guardIdentities('Ako sme riešili pre Obec Horná Lehota s pánom Novákom…', {
      names: ['Ján Novák'],
      clients: ['Obec Horná Lehota'],
    });
    expect(out).not.toMatch(/Lehota|Novák/);
    expect(out).toContain('[…]');
  });
});
