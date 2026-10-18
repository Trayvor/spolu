import { MENTION_RE, type TicketDraftSource } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { listRecentMessages, teamRepliesOfTickets } from '../chat/messages.js';
import { getTicketChannel } from '../chat/service.js';
import { clientLanguages, getGroup, peopleNamesOfGroups } from '../groups/service.js';
import { draftKnowledge } from '../knowledge/service.js';
import type { TicketRow } from '../tickets/service.js';
import { similarResolvedTickets, type SimilarTicket } from '../tickets/similar.js';
import { clientLanguageOf, languageName } from './client-language.js';
import { draftTerms, maskIdentities, redactContacts, type Identities } from './draft-terms.js';
import { DRAFT_LIMITS, type TicketDraftInput } from './ticket-draft.js';

/**
 * Gathers what an AI draft of a ticket reply sees ("Navrhnúť odpoveď", 2026-10-19), through the
 * owning modules' service functions: the ticket, its chat, the knowledge the ticket's client may
 * be shown and up to three similar resolved tickets of any client, another client's identity
 * masked (spec §5, §8). The caller checks `canDraftTicketReply`. At most 10 queries, none per item.
 */

export type DraftContext = {
  request: TicketDraftInput;
  /** Every source the AI was given, by id (what `sourceIds` may name). */
  sources: Map<string, TicketDraftSource>;
  /** For the `sanitizeDraft` guard; never sent. */
  otherClientIdentities: Identities;
};

const KNOWLEDGE_MAX = 5;
const SIMILAR_MAX = 3;

const isTeam = (role: string) => role === 'admin' || role === 'superadmin';
const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || null;
const present = (values: (string | null | undefined)[]) =>
  values.filter((v): v is string => typeof v === 'string' && v.trim() !== '');

/** The identities of one similar ticket to mask: its requester, and for another client more. */
function identitiesOf(
  ticket: SimilarTicket,
  otherClient: boolean,
  peopleByGroup: Map<string, string[]>,
): Identities {
  const names = present([ticket.requesterName]);
  if (!otherClient) return { names, clients: [] };
  return {
    names: [...names, ...(ticket.groupId ? (peopleByGroup.get(ticket.groupId) ?? []) : [])],
    clients: present([ticket.groupName]),
  };
}

/**
 * A similar ticket's text as it may reach the AI: contacts redacted first (so a name inside an
 * email address never leaves the rest of it behind), then the identities masked.
 */
function masked(text: string, identities: Identities, ticket: SimilarTicket): string {
  let out = text;
  // The requester's own email and phone, also in a form the general patterns would miss.
  if (ticket.requesterEmail?.trim()) out = out.split(ticket.requesterEmail.trim()).join('[e-mail]');
  if (ticket.requesterPhone?.trim())
    out = out.split(ticket.requesterPhone.trim()).join('[telefón]');
  return maskIdentities(redactContacts(out), identities);
}

export async function buildTicketDraftContext(
  db: Db,
  ticket: TicketRow,
  instructions: string,
): Promise<DraftContext> {
  const [group, channel] = await Promise.all([
    ticket.groupId === null ? null : getGroup(db, ticket.groupId),
    getTicketChannel(db, ticket.id),
  ]);
  const [recent, languages] = await Promise.all([
    channel === null ? [] : listRecentMessages(db, channel.id, DRAFT_LIMITS.messages),
    group?.egrantUrl && clientLanguageOf(group.egrantUrl, []) === null
      ? clientLanguages(db, group.id)
      : ([] as string[]),
  ]);
  // Mentions as the names of the chat's authors (no lookups); anyone else is "@?".
  const nameById = new Map(recent.map((m) => [m.authorId, m.authorName]));
  const withNames = (body: string) =>
    body.replace(MENTION_RE, (_, id: string) =>
      id === 'all' ? '@all' : `@${nameById.get(id) ?? '?'}`,
    );
  const conversation = recent
    .map((m) => ({
      author: m.authorName,
      role: isTeam(m.authorRole) ? ('team' as const) : ('client' as const),
      text: withNames(m.body).trim(),
    }))
    .filter((m) => m.text !== '');
  const newestClient = [...conversation].reverse().find((m) => m.role === 'client');

  const terms = draftTerms(present([ticket.subject, ticket.body, newestClient?.text]));
  const [knowledge, similar] = await Promise.all([
    draftKnowledge(db, { groupId: ticket.groupId, terms, limit: KNOWLEDGE_MAX }),
    similarResolvedTickets(db, {
      ticketId: ticket.id,
      groupId: ticket.groupId,
      terms,
      limit: SIMILAR_MAX,
    }),
  ]);
  const isOther = (t: SimilarTicket) => ticket.groupId === null || t.groupId !== ticket.groupId;
  const otherGroupIds = [
    ...new Set(similar.filter(isOther).flatMap((t) => (t.groupId ? [t.groupId] : []))),
  ];
  const [peopleByGroup, replies] = await Promise.all([
    peopleNamesOfGroups(db, otherGroupIds),
    teamRepliesOfTickets(
      db,
      similar.map((t) => t.id),
      DRAFT_LIMITS.answers,
    ),
  ]);

  const otherClientIdentities: Identities = { names: [], clients: [] };
  const similarTickets = similar.map((t) => {
    const identities = identitiesOf(t, isOther(t), peopleByGroup);
    if (isOther(t)) {
      otherClientIdentities.names.push(...identities.names);
      otherClientIdentities.clients.push(...identities.clients);
    }
    const mask = (text: string) => masked(text, identities, t);
    return {
      id: t.id,
      subject: t.subject === null ? null : mask(t.subject),
      body: mask(t.bodyHead),
      answers: (replies.get(t.id) ?? []).map((body) =>
        // Mentions in another ticket's chat name nobody here.
        mask(body.replace(MENTION_RE, (_, id: string) => (id === 'all' ? '@all' : '@?'))),
      ),
    };
  });

  const sources = new Map<string, TicketDraftSource>();
  for (const k of knowledge) {
    sources.set(k.id, {
      kind: 'knowledge',
      id: k.id,
      type: k.type,
      title: k.title,
      fromAdminGroup: k.fromAdminGroup,
    });
  }
  for (const t of similar) {
    sources.set(t.id, { kind: 'ticket', id: t.id, number: t.number, subject: t.subject });
  }

  const language = group?.egrantUrl ? clientLanguageOf(group.egrantUrl, languages) : null;
  return {
    request: {
      ticket: {
        number: ticket.number,
        subject: ticket.subject,
        area: ticket.area,
        programme: ticket.programme,
        status: ticket.status,
        requesterFirstName: firstName(ticket.requesterName),
        body: ticket.body ?? '',
      },
      conversation,
      knowledge: knowledge.map((k) => ({ id: k.id, type: k.type, title: k.title, text: k.text })),
      similarTickets,
      instructions,
      fallbackLanguage: languageName(language ?? 'sk'),
    },
    sources,
    otherClientIdentities,
  };
}
