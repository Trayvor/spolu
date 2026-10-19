CREATE INDEX "notification_events_unread_subject_idx" ON "notification_events" USING btree ("user_id",(coalesce(
    'ticket:' || ("payload" ->> 'ticketId'),
    'task:' || ("payload" ->> 'taskId'),
    case when "kind" like 'meeting.%' then 'knowledge:' || ("payload" ->> 'itemId') end,
    ("payload" ->> 'subjectKind') || ':' || ("payload" ->> 'subjectId'),
    'chat:' || ("payload" ->> 'channelId')
  )),"created_at") WHERE "notification_events"."in_centre" and "notification_events"."read_at" is null;