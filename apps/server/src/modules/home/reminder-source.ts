import type { HomeReminder, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * Where the dashboard's "Upcoming reminders" card reads from. `modules/home` never imports the
 * reminders module: `app.ts` registers a thin wrapper over its service (`listUpcomingForUser`,
 * `countUpcomingForUser`), so the two can change apart. Without a registered source the card is
 * not shown (`{ available: false }`). Phase 19's task reminders arrive through the same source.
 *
 * The methods take the actor (not only a user id) because the reminders service checks that each
 * subject is still readable for them.
 */
export type ReminderSource = {
  /** My next reminder times from `from`, earliest first, at most `limit`. */
  upcoming(
    db: Db,
    actor: SessionUser,
    opts: { from: Date; limit: number },
  ): Promise<HomeReminder[]>;
  /** How many reminder times I have from `from` to `from + 7 days` (capped at 100). */
  countNextWeek(db: Db, actor: SessionUser, from: Date): Promise<number>;
};

let source: ReminderSource | null = null;

/** Sets the dashboard's reminder source; `null` removes it (tests). */
export function registerReminderSource(next: ReminderSource | null): void {
  source = next;
}

export function getReminderSource(): ReminderSource | null {
  return source;
}
