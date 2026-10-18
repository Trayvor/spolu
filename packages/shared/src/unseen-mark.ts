import { z } from 'zod';

/**
 * How a task or ticket with an unseen change is marked (2026-10-18): `message` when the unseen
 * changes include a message in its chat (a yellow ring with a dot), `change` for any other
 * (a plain yellow dot); null when nothing is unseen. See
 * docs/superpowers/specs/2026-10-17-unseen-changes-design.md.
 */
export const UnseenMarks = ['change', 'message'] as const;
export const UnseenMarkSchema = z.enum(UnseenMarks);
export type UnseenMark = z.infer<typeof UnseenMarkSchema>;
