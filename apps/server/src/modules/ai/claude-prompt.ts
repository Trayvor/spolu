import { CLAUDE_NOTES_MAX, CLAUDE_PROMPT_MAX, type UserLanguage } from '@spolu/shared';

/**
 * The prompt of "Otvoriť v Claude" (Phase 29): pure formatting of a ticket's or task's context,
 * in Slovak, with the admin's notes and the eGrant MCP instructions at the end. `claude-context.ts` gathers the input.
 */

/** One chat message, mentions already written as `@Name`. */
export type PromptMessage = { at: Date; author: string; text: string; files: string[] };

export type PromptInput = {
  kind: 'ticket' | 'task';
  /** "Tiket #12: subject" or "Úloha: title". */
  heading: string;
  /** The ticket or task in Help by eGrant. */
  link: string;
  /** Filled fields only, already formatted. */
  fields: { label: string; value: string }[];
  /** The ticket's text or the task's description. */
  text: string | null;
  files: string[];
  /** The newest messages, oldest first. */
  messages: PromptMessage[];
  /** The chat has older messages than `messages`. */
  olderOmitted: boolean;
  /** The client's eGrant instance (an origin), or null when it is unknown. */
  instanceUrl: string | null;
  /** The admin's own notes or instructions for Claude, optional ('' for none). */
  notes: string;
  /** The admin's UI language: Claude answers in it. */
  language: UserLanguage;
  /** Who generated the prompt: the authenticated actor, set by the server. */
  generatedBy: { name: string; email: string; role: string };
  generatedAt: Date;
};

/** Each message is cut to this many characters. */
const PROMPT_MESSAGE_MAX = 1500;
/** The ticket's text or the task's description is cut to this many characters. */
const PROMPT_TEXT_MAX = 6000;
/** At most this many file names are listed. */
const PROMPT_FILES_MAX = 50;
/** The admin's notes (the request allows `CLAUDE_NOTES_MAX`; this guards direct callers). */
const PROMPT_NOTES_MAX = CLAUDE_NOTES_MAX;

const ANSWER_IN: Record<UserLanguage, string> = {
  sk: 'po slovensky',
  en: 'po anglicky',
  cs: 'po česky',
  sl: 'po slovinsky',
  bg: 'po bulharsky',
  et: 'po estónsky',
  it: 'po taliansky',
  hr: 'po chorvátsky',
  uk: 'po ukrajinsky',
};

const bratislavaTime = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Bratislava',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** `2026-10-17 14:05` in Bratislava time. */
export function formatPromptTime(at: Date): string {
  const part = (type: string) =>
    bratislavaTime.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

/** The first `max` code points, with `…` when something was cut. */
function cut(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`;
}

function messageLine(m: PromptMessage): string {
  const text = cut(m.text.trim(), PROMPT_MESSAGE_MAX);
  const files = m.files.length > 0 ? `\n  (súbory: ${m.files.join(', ')})` : '';
  return `[${formatPromptTime(m.at)}] ${m.author}: ${text}${files}`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function instanceSection(instanceUrl: string | null): string[] {
  if (instanceUrl === null) {
    return [
      '## Inštancia eGrant',
      'Inštancia eGrant nie je známa (chýba klient aj odkaz na inštanciu). Kým začneš, opýtaj sa ma, o ktorú inštanciu ide.',
    ];
  }
  return ['## Inštancia eGrant', `${instanceUrl} (hostname: ${hostOf(instanceUrl)})`];
}

function instructions(input: PromptInput): string[] {
  const find =
    input.instanceUrl === null
      ? 'Keď ti poviem inštanciu, nájdi ju nástrojom `admin_instance_list`.'
      : `Inštanciu nájdi nástrojom \`admin_instance_list\` s parametrom query "${hostOf(input.instanceUrl)}" a over, že sa jej hostname zhoduje.`;
  const chat = input.kind === 'ticket' ? 'tiketu' : 'úlohy';
  return [
    '## Ako postupovať',
    `1. Použi konektor eGrant MCP. ${find} Pracuj iba s touto jednou inštanciou.`,
    '2. Nástrojom `admin_instance_tools` zisti, aké nástroje inštancia ponúka (s ich schémami).',
    '3. Iba čítaj (`admin_instance_call`): over, čo klient opisuje, a nájdi príčinu.',
    '',
    '## Tvoja prvá odpoveď',
    'Prvá odpoveď musí byť informatívna a obsahovať:',
    'a) príčinu problému;',
    'b) čo alebo koho problém ovplyvnil, ak je to relevantné;',
    'c) kroky riešenia;',
    'd) reálne a relevantné riziká, ak nejaké sú;',
    'e) otázku, či mám problém opraviť podľa tohto plánu.',
    '',
    `Kým výslovne nepotvrdím plán, nerob žiadne zmeny: nevolaj \`admin_instance_call_write\` ani nič iné, čo zapisuje. Po potvrdení urob iba schválené kroky; pred každou inou zmenou sa najprv opýtaj. Po vyriešení navrhni krátku odpoveď klientovi do chatu ${chat}.`,
    '',
    `Odpovedaj ${ANSWER_IN[input.language]}.`,
  ];
}

function render(input: PromptInput, messages: PromptMessage[], olderOmitted: boolean): string {
  const lines: string[] = [
    `Pomôž mi vyriešiť ${input.kind === 'ticket' ? 'tento tiket' : 'túto úlohu'} z Help by eGrant (klientska podpora eGrant).`,
    '',
    `# ${input.heading}`,
    `Odkaz v Help by eGrant: ${input.link}`,
    `Vygeneroval: ${input.generatedBy.name} <${input.generatedBy.email}> (${input.generatedBy.role}, Help by eGrant), ${formatPromptTime(input.generatedAt)}`,
  ];
  if (input.fields.length > 0) {
    lines.push('', '## Údaje', ...input.fields.map((f) => `- ${f.label}: ${f.value}`));
  }
  const text = input.text?.trim() ?? '';
  if (text !== '') lines.push('', '## Popis', cut(text, PROMPT_TEXT_MAX));
  if (input.files.length > 0) {
    lines.push(
      '',
      '## Súbory',
      'Obsah súborov v tomto texte nie je. Ak ich potrebuješ a nie sú priložené v chate, vypýtaj si ich.',
      ...input.files.slice(0, PROMPT_FILES_MAX).map((f) => `- ${f}`),
    );
    const more = input.files.length - PROMPT_FILES_MAX;
    if (more > 0) lines.push(`- … a ďalšie (${more})`);
  }
  lines.push('', '## Chat (najnovšie správy, od najstaršej)');
  if (olderOmitted) lines.push('(staršie správy vynechané)');
  if (messages.length === 0 && !olderOmitted) lines.push('(v chate nie sú žiadne správy)');
  lines.push(...messages.map(messageLine));
  lines.push('', ...instanceSection(input.instanceUrl));
  const notes = input.notes.trim();
  if (notes !== '') {
    lines.push('', '## Poznámky administrátora (majú prednosť)', cut(notes, PROMPT_NOTES_MAX));
  }
  lines.push('', ...instructions(input));
  return lines.join('\n');
}

/**
 * The prompt, at most `CLAUDE_PROMPT_MAX` characters: when longer, the oldest messages go first
 * (the text is already cut, the instructions always stay).
 */
export function buildClaudePrompt(input: PromptInput): string {
  let messages = input.messages;
  let olderOmitted = input.olderOmitted;
  let prompt = render(input, messages, olderOmitted);
  while (prompt.length > CLAUDE_PROMPT_MAX && messages.length > 0) {
    messages = messages.slice(1);
    olderOmitted = true;
    prompt = render(input, messages, olderOmitted);
  }
  return prompt;
}
