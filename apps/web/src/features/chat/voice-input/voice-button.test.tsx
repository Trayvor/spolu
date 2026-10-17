import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { setLanguage } from '@/i18n';
import { appendTranscript } from './api';
import { VoiceButton } from './voice-button';

/** A MediaRecorder stand-in: `stop` hands one chunk to the page, like a browser does. */
class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
  static last: FakeRecorder | null = null;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options: { mimeType?: string }) {
    this.mimeType = options.mimeType ?? '';
    FakeRecorder.last = this;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubServer(voice: boolean, transcript = 'second line') {
  const uploads: { type: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/ai-tools')) return json({ text: false, translate: null, voice });
      uploads.push({ type: new Headers(init?.headers).get('content-type') });
      return json({ text: transcript });
    }),
  );
  return uploads;
}

function Harness({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <>
      <textarea aria-label="Draft" value={text} onChange={(e) => setText(e.target.value)} />
      <VoiceButton channelId="c1" getText={() => text} setText={setText} />
    </>
  );
}

function renderButton(initial = 'First line.') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

const draft = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Draft' });

beforeAll(async () => {
  await setLanguage('en');
});
beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
  });
  stopTrack.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VoiceButton', () => {
  it('is hidden without transcription on the server', async () => {
    stubServer(false);
    renderButton();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Dictate' })).not.toBeInTheDocument();
  });

  it('records until Stop, shows a timer, and appends the transcript to the draft', async () => {
    const uploads = stubServer(true);
    renderButton();
    await userEvent.click(await screen.findByRole('button', { name: 'Dictate' }));
    expect(await screen.findByRole('timer')).toHaveTextContent('0:00 / 5:00');
    await userEvent.click(screen.getByRole('button', { name: 'Stop and transcribe' }));
    await waitFor(() => expect(draft().value).toBe('First line. second line'));
    expect(uploads).toEqual([{ type: 'audio/webm;codecs=opus' }]);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Dictate' })).toBeEnabled();
  });

  it('Cancel throws the recording away', async () => {
    const uploads = stubServer(true);
    renderButton();
    await userEvent.click(await screen.findByRole('button', { name: 'Dictate' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel recording' }));
    expect(await screen.findByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    expect(uploads).toEqual([]);
    expect(draft().value).toBe('First line.');
    expect(stopTrack).toHaveBeenCalled();
  });

  it('stops by itself at 5 minutes and still transcribes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubServer(true);
    renderButton('');
    await userEvent.click(await screen.findByRole('button', { name: 'Dictate' }));
    await screen.findByRole('timer');
    await act(async () => {
      vi.advanceTimersByTime(301_000);
    });
    await waitFor(() => expect(draft().value).toBe('second line'));
    expect(await screen.findByText('The recording stopped at 5 minutes.')).toBeVisible();
  });

  it('says so when the microphone is not allowed', async () => {
    stubServer(true);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException('denied', 'NotAllowedError');
        }),
      },
    });
    renderButton();
    await userEvent.click(await screen.findByRole('button', { name: 'Dictate' }));
    expect(
      await screen.findByText('Allow the microphone in your browser to dictate.'),
    ).toBeVisible();
  });
});

describe('appendTranscript', () => {
  it('adds the transcript after the draft', () => {
    expect(appendTranscript('', ' hello ')).toBe('hello');
    expect(appendTranscript('Hi.', 'there')).toBe('Hi. there');
    expect(appendTranscript('Hi.\n', 'there')).toBe('Hi.\nthere');
    expect(appendTranscript('Hi.', '  ')).toBe('Hi.');
  });
});
