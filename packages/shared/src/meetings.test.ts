import { describe, expect, it } from 'vitest';
import { KnowledgeDraftSchema, KnowledgePatchSchema } from './knowledge.js';
import { isMeetingAiBusy, MeetingPatchSchema, MeetingSummarySchema } from './meetings.js';

const at = '2030-01-10T09:00:00.000Z';

describe('meeting schemas', () => {
  it('a draft needs the date; links default to null, the transcript to empty, no reminder', () => {
    const draft = KnowledgeDraftSchema.parse({
      type: 'meeting',
      title: 'Call',
      meeting: { startsAt: at },
    });
    expect(draft).toMatchObject({
      type: 'meeting',
      meeting: {
        startsAt: at,
        meetingUrl: null,
        recordingUrl: null,
        transcriptUrl: null,
        transcript: '',
      },
      fileIds: [],
    });
    expect(
      KnowledgeDraftSchema.safeParse({ type: 'meeting', title: 'Call', meeting: {} }).success,
    ).toBe(false);
    expect(
      KnowledgeDraftSchema.safeParse({
        type: 'meeting',
        title: 'Call',
        meeting: { startsAt: at, meetingUrl: 'javascript:x' },
      }).success,
    ).toBe(false);
  });

  it('an optional reminder may have no time; a patch may clear a link and the summary', () => {
    expect(
      KnowledgeDraftSchema.safeParse({
        type: 'meeting',
        title: 'Call',
        meeting: { startsAt: at },
        reminder: { times: [], recipientIds: [] },
      }).success,
    ).toBe(true);
    expect(MeetingPatchSchema.parse({ meetingUrl: null, summary: null })).toEqual({
      meetingUrl: null,
      summary: null,
    });
    expect(MeetingPatchSchema.safeParse({ recordingState: 'ready' }).success).toBe(false);
    expect(
      KnowledgePatchSchema.safeParse({ updatedAt: at, meeting: { transcript: 'x' } }).success,
    ).toBe(true);
  });

  it('a summary: blank list entries and fake dates are refused', () => {
    const ok = {
      summary: 'S',
      decisions: ['D'],
      actionItems: [{ text: 'T', assignee: null, deadline: '2030-01-02' }],
      openQuestions: [],
      language: 'sk',
    };
    expect(MeetingSummarySchema.safeParse(ok).success).toBe(true);
    expect(MeetingSummarySchema.safeParse({ ...ok, decisions: [' '] }).success).toBe(false);
    expect(
      MeetingSummarySchema.safeParse({
        ...ok,
        actionItems: [{ text: 'T', assignee: null, deadline: 'tomorrow' }],
      }).success,
    ).toBe(false);
  });

  it('a run is busy while queued, transcribing or summarizing', () => {
    expect(
      ['queued', 'transcribing', 'summarizing'].every((s) => isMeetingAiBusy(s as never)),
    ).toBe(true);
    expect(isMeetingAiBusy('done')).toBe(false);
    expect(isMeetingAiBusy('failed')).toBe(false);
  });
});
