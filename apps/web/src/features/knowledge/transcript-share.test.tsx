import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeItemDto, MeetingDetail } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import { TranscriptSection } from './meeting-view';

const t = (key: string) => i18n.t(key);

const item = (meeting: Partial<MeetingDetail>) =>
  ({
    id: 'k1',
    meetingDetail: { transcript: 'Jana: Dobrý deň.', transcriptSource: 'teams', ...meeting },
  }) as unknown as KnowledgeItemDto;

describe('a Teams transcript held for admins (Teams T1)', () => {
  beforeAll(async () => {
    await setLanguage('en');
    await loadNamespace('knowledge');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('says only admins see it and shares it with the client', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<TranscriptSection item={item({ transcriptAdminsOnly: true })} onChanged={onChanged} />);
    expect(screen.getByText(t('knowledge.meeting.transcriptFromTeams'))).toBeInTheDocument();
    expect(screen.getByText(t('knowledge.meeting.transcriptAdminsOnly'))).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: t('knowledge.meeting.shareTranscript') }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/knowledge/k1/meeting/share-transcript',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a shared one has no share button', () => {
    render(<TranscriptSection item={item({ transcriptAdminsOnly: false })} onChanged={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: t('knowledge.meeting.shareTranscript') }),
    ).toBeNull();
  });
});
