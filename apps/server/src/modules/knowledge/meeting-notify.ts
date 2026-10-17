import type { MeetingEventPayload, NotificationKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { listGroupPeople } from '../groups/service.js';
import { recordNotifications, requestDelivery } from '../notifications/service.js';

// 2026-10-17: the meeting notifications (the `meetings` notification group). Which of the
// recipients hears what (mode, channel, still a person of the group) is the delivery's decision.

type MeetingRef = {
  itemId: string;
  groupId: string;
  title: string;
  startsAt: Date;
  adminsOnly: boolean;
};

const payloadOf = (m: MeetingRef): MeetingEventPayload => ({
  itemId: m.itemId,
  groupId: m.groupId,
  title: m.title,
  startsAt: m.startsAt.toISOString(),
});

/**
 * Records `meeting.scheduled` (a new meeting) or `meeting.rescheduled` (its start moved) for the
 * people who can see it: the group's people (its clients and every admin; admins only for an
 * admins-only meeting), never the person who made the change. A start that is not in the future
 * notifies nobody. Call it inside the write's transaction; returns the event ids for
 * `requestDelivery` after the commit.
 */
export async function recordMeetingScheduled(
  tx: Db,
  kind: Extract<NotificationKind, 'meeting.scheduled' | 'meeting.rescheduled'>,
  meeting: MeetingRef,
  actorId: string,
  now: Date = new Date(),
): Promise<string[]> {
  if (meeting.startsAt.getTime() <= now.getTime()) return [];
  const people = await listGroupPeople(tx, meeting.groupId);
  const recipients = people
    .filter((p) => p.id !== actorId && (!meeting.adminsOnly || p.isAdmin))
    .map((p) => p.id);
  if (recipients.length === 0) return [];
  return recordNotifications(tx, {
    kind,
    groupId: meeting.groupId,
    recipients,
    payload: payloadOf(meeting),
  });
}

/**
 * Tells the admin who started an AI run ("Spracovať s AI") how it ended: `meeting.summary_ready`
 * or `meeting.summary_failed` (after the last attempt). Records and requests delivery; a failure
 * here is logged and never fails the run.
 */
export async function notifyMeetingAiResult(
  deps: { db: Db; jobs: JobQueue },
  kind: Extract<NotificationKind, 'meeting.summary_ready' | 'meeting.summary_failed'>,
  meeting: Omit<MeetingRef, 'adminsOnly'>,
  requestedBy: string | undefined,
): Promise<void> {
  // A job queued before the requester travelled with it notifies nobody.
  if (!requestedBy) return;
  try {
    const ids = await recordNotifications(deps.db, {
      kind,
      groupId: meeting.groupId,
      recipients: [requestedBy],
      payload: payloadOf({ ...meeting, adminsOnly: true }),
    });
    await requestDelivery(deps.jobs, ids);
  } catch (error) {
    console.error(`meetings: the AI result of ${meeting.itemId} could not be notified`, error);
  }
}
