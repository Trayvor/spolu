import { describe, expect, it } from 'vitest';
import { CLAUDE_PROMPT_MAX } from '@spolu/shared';
import { buildClaudePrompt, type PromptInput } from './claude-prompt.js';

const base = (over: Partial<PromptInput> = {}): PromptInput => ({
  kind: 'ticket',
  heading: 'Tiket #12: Nejde odoslať žiadosť',
  link: 'https://help.example.sk/tickets/t1',
  fields: [
    { label: 'Stav', value: 'V riešení' },
    { label: 'Klient', value: 'Supermesto' },
  ],
  text: 'Pri odoslaní žiadosti vidím chybu.',
  files: ['chyba.png'],
  messages: [
    {
      at: new Date('2026-10-17T12:05:00Z'),
      author: 'Anna',
      text: 'Ahoj @Peter, pozrieš to?',
      files: ['log.txt'],
    },
  ],
  olderOmitted: false,
  instanceUrl: 'https://supermesto.egrant.sk',
  notes: '',
  language: 'sk',
  ...over,
});

describe('buildClaudePrompt', () => {
  it('carries the heading, link, fields, text, files and chat with Bratislava time', () => {
    const p = buildClaudePrompt(base());
    expect(p).toContain('# Tiket #12: Nejde odoslať žiadosť');
    expect(p).toContain('https://help.example.sk/tickets/t1');
    expect(p).toContain('- Stav: V riešení');
    expect(p).toContain('- Klient: Supermesto');
    expect(p).toContain('Pri odoslaní žiadosti vidím chybu.');
    expect(p).toContain('- chyba.png');
    expect(p).toContain('[2026-10-17 14:05] Anna: Ahoj @Peter, pozrieš to?');
    expect(p).toContain('(súbory: log.txt)');
    expect(p).not.toContain('staršie správy');
  });

  it('names the instance and tells Claude how to use the eGrant MCP safely', () => {
    const p = buildClaudePrompt(base());
    expect(p).toContain('https://supermesto.egrant.sk');
    expect(p).toContain('admin_instance_list');
    expect(p).toContain('"supermesto.egrant.sk"');
    expect(p).toContain('admin_instance_tools');
    expect(p).toContain('admin_instance_call');
    expect(p).toContain('admin_instance_call_write');
    expect(p).toMatch(/nepotvrdím/);
    expect(p).toContain('Odpovedaj po slovensky.');
  });

  it('asks for an informative first reply and forbids writes until the admin confirms', () => {
    const p = buildClaudePrompt(base());
    expect(p).toContain('## Tvoja prvá odpoveď');
    expect(p).toContain('a) príčinu problému;');
    expect(p).toContain('b) čo alebo koho problém ovplyvnil, ak je to relevantné;');
    expect(p).toContain('c) kroky riešenia;');
    expect(p).toContain('d) reálne a relevantné riziká, ak nejaké sú;');
    expect(p).toContain('e) otázku, či mám problém opraviť podľa tohto plánu.');
    expect(p).toContain('Kým výslovne nepotvrdím plán, nerob žiadne zmeny');
    expect(p).toContain('Obsah súborov v tomto texte nie je.');
  });

  it('carries the admin notes when given, before the instructions', () => {
    expect(buildClaudePrompt(base())).not.toContain('Poznámky administrátora');
    const p = buildClaudePrompt(base({ notes: '  Pozri najmä program Šport.  ' }));
    expect(p).toContain('## Poznámky administrátora (majú prednosť)\nPozri najmä program Šport.');
    expect(p.indexOf('Poznámky administrátora')).toBeLessThan(p.indexOf('## Ako postupovať'));
  });

  it('lists at most 50 file names', () => {
    const files = Array.from({ length: 53 }, (_, i) => `f${i}.pdf`);
    const p = buildClaudePrompt(base({ files }));
    expect(p).toContain('- f49.pdf');
    expect(p).not.toContain('- f50.pdf');
    expect(p).toContain('- … a ďalšie (3)');
  });

  it('asks for the instance when it is unknown', () => {
    const p = buildClaudePrompt(base({ instanceUrl: null }));
    expect(p).toContain('Inštancia eGrant nie je známa');
    expect(p).not.toContain('"supermesto.egrant.sk"');
  });

  it('answers in the admin language', () => {
    expect(buildClaudePrompt(base({ language: 'uk' }))).toContain('Odpovedaj po ukrajinsky.');
    expect(buildClaudePrompt(base({ language: 'en' }))).toContain('Odpovedaj po anglicky.');
  });

  it('skips empty sections and says when older messages were left out', () => {
    const p = buildClaudePrompt(
      base({ text: null, files: [], messages: [], olderOmitted: false, kind: 'task' }),
    );
    expect(p).not.toContain('## Popis');
    expect(p).not.toContain('## Súbory');
    expect(p).toContain('(v chate nie sú žiadne správy)');
    expect(p).toContain('túto úlohu');
    const older = buildClaudePrompt(base({ olderOmitted: true }));
    expect(older).toContain('(staršie správy vynechané)');
  });

  it('cuts a long message and a long text', () => {
    const p = buildClaudePrompt(
      base({
        text: 'b'.repeat(10_000),
        messages: [{ at: new Date(), author: 'A', text: 'a'.repeat(5000), files: [] }],
      }),
    );
    expect(p).toContain(`${'a'.repeat(1500)}…`);
    expect(p).not.toContain('a'.repeat(1501));
    expect(p).toContain(`${'b'.repeat(6000)}…`);
    expect(p).not.toContain('b'.repeat(6001));
  });

  it('drops the oldest messages first to stay under the cap, keeping the instructions', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 9, 17, 8, i)),
      author: `Autor${i}`,
      text: `${i} ${'x'.repeat(1400)}`,
      files: [],
    }));
    const p = buildClaudePrompt(base({ messages }));
    expect(p.length).toBeLessThanOrEqual(CLAUDE_PROMPT_MAX);
    expect(p).toContain('Autor29:');
    expect(p).not.toContain('Autor0:');
    expect(p).toContain('(staršie správy vynechané)');
    expect(p).toContain('admin_instance_call_write');
  });
});
