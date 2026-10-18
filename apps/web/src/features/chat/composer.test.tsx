import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, MessageDto } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { ApiError } from '@/lib/api';
import { groupPeopleQuery } from '@/features/groups/api';
import { createRef } from 'react';
import { Composer, type ComposerHandle, type ComposerProps } from './composer';
import { FormatToolbar } from './format-toolbar';

const upload = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock('@/features/files/upload', () => upload);

const people: GroupPerson[] = [
  { id: 'jana', name: 'Jana Nováková', isAdmin: false, isManager: false },
  { id: 'peter', name: 'Peter Horváth', isAdmin: true, isManager: false },
  { id: 'mira', name: 'Mira Kováčová', isAdmin: true, isManager: true },
];

async function renderComposer(props: Partial<ComposerProps> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const client = new QueryClient();
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  const ref = createRef<ComposerHandle>();
  const view = render(
    <QueryClientProvider client={client}>
      <Composer mode="new" groupId="g1" ref={ref} {...props} onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  await field();
  return { onSubmit: onSubmit as ReturnType<typeof vi.fn>, client, ref, ...view };
}

/** The editor is a lazy chunk: wait for it. */
const field = () => screen.findByRole('textbox');
const box = () => screen.getByRole('textbox');
/** The bordered box around the field, its toolbar and its buttons. */
const frame = () => box().closest('.rounded-lg') as HTMLElement;
const fileInput = (c: HTMLElement) => c.querySelector('input[type=file]') as HTMLInputElement;
const send = () => screen.getByRole('button', { name: 'Send' });
const info = (id: string): FileInfo => ({
  id,
  name: `${id}.txt`,
  mime: 'text/plain',
  size: 10,
  width: null,
  height: null,
  hasPreview: false,
});
const txt = (name: string) => new File(['x'], name, { type: 'text/plain' });

beforeAll(async () => {
  await setLanguage('en');
});
beforeEach(() => {
  upload.uploadFile.mockReset();
});

describe('Composer', () => {
  it('Send and attach sit inside the bordered box, on the formatting row', async () => {
    await renderComposer();
    const inside = within(frame());
    const attach = inside.getByRole('button', { name: 'Add' });
    expect(inside.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    const toolbar = inside.getByRole('toolbar');
    expect(toolbar.parentElement).toBe(attach.parentElement);
    expect(toolbar.parentElement).toBe(inside.getByRole('button', { name: 'Send' }).parentElement);
  });

  it('extra actions sit on that row, just before Send', async () => {
    await renderComposer({ extraActions: <button type="button">AI</button> });
    const send = within(frame()).getByRole('button', { name: 'Send' });
    expect(send.previousElementSibling).toHaveTextContent('AI');
  });

  it('Send swaps its word for a 44 px paper plane on phones and keeps its name', async () => {
    await renderComposer();
    const button = send();
    expect(button).toHaveAttribute('aria-label', 'Send');
    expect(button).toHaveClass('max-[640px]:size-11', 'max-[640px]:px-0', 'bg-primary');
    expect(within(button).getByText('Send')).toHaveClass('max-[640px]:hidden');
    const icon = button.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('hidden', 'max-[640px]:block');
    expect(button).toBeDisabled();
  });

  it('edit mode keeps Save and Cancel in the box, without the paperclip', async () => {
    await renderComposer({ mode: 'edit', initialBody: 'a', onCancel: vi.fn() });
    const inside = within(frame());
    expect(inside.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(inside.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('uploaded files are listed under the box, not in it', async () => {
    const user = userEvent.setup();
    upload.uploadFile.mockReturnValue(new Promise(() => undefined));
    const { container } = await renderComposer();
    await user.upload(fileInput(container), [txt('a.txt')]);
    expect(within(frame()).queryByText('a.txt')).toBeNull();
    expect(screen.getByText('a.txt')).toBeInTheDocument();
  });

  it('Enter sends, Shift+Enter adds a line', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'hello{Shift>}{Enter}{/Shift}world');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box().querySelectorAll('p')).toHaveLength(2);
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hello\nworld', fileIds: [] });
    expect(box()).toHaveTextContent(/^$/);
  });

  it('the emoji button opens the reactions’ set and inserts the emoji at the cursor', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'Hi ');
    await user.click(within(frame()).getByRole('button', { name: 'Insert emoji' }));
    await user.click(await screen.findByRole('button', { name: 'Insert 👍' }));
    expect(screen.queryByRole('button', { name: 'Insert 👍' })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'Hi 👍', fileIds: [] });
  });

  it('Markdown typed in the field shows as formatting and is sent as Markdown', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'say **hi** to _all_');
    expect(box().querySelector('strong')).toHaveTextContent('hi');
    expect(box().querySelector('em')).toHaveTextContent('all');
    expect(box()).toHaveTextContent('say hi to all');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'say **hi** to _all_', fileIds: [] });
  });

  it('a list typed with "- " continues on Shift+Enter', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), '- one{Shift>}{Enter}{/Shift}two{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '- one\n- two', fileIds: [] });
  });

  it('Cmd/Ctrl+B turns bold on and off while typing', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'say ');
    await user.keyboard('{Control>}b{/Control}hi{Control>}b{/Control} now{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'say **hi** now', fileIds: [] });
  });

  it('the toolbar offers every format with a label and shows the active one', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    for (const name of [
      'Bold',
      'Italic',
      'Strikethrough',
      'Link',
      'Bulleted list',
      'Numbered list',
      'Quote',
      'Code',
    ]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title');
    }
    await user.click(box());
    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('x{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '`x`', fileIds: [] });
  });

  it('Link asks for the address and inserts it', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'see ');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    const address = screen.getByRole('textbox', { name: 'Link address' });
    await user.type(address, 'javascript:alert(1){Enter}');
    expect(address).toHaveAttribute('aria-invalid', 'true');
    await user.clear(address);
    await user.type(address, 'egrant.sk/vyzvy{Enter}');
    expect(screen.queryByRole('textbox', { name: 'Link address' })).toBeNull();
    expect(box().querySelector('a')).toHaveAttribute('href', 'https://egrant.sk/vyzvy');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'see https://egrant.sk/vyzvy', fileIds: [] });
  });

  it('typing @ja shows Jana, ArrowDown + Enter inserts a pill and sends <@id>', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'hi @ja');
    expect(await screen.findByRole('option', { name: /Jana Nováková/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Peter/ })).toBeNull();
    expect(box()).toHaveAttribute('aria-controls');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(box().querySelector('[data-mention="jana"]')).toHaveTextContent('@Jana Nováková');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('ok{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hi <@jana> ok', fileIds: [] });
  });

  it('@ja + Enter picks the person, never Everyone', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), '@ja');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}');
    expect(box()).toHaveTextContent('@Jana Nováková');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '<@jana>', fileIds: [] });
  });

  it('@ + Enter picks Everyone only when nothing else is typed', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), '@');
    await screen.findByRole('listbox');
    await user.keyboard('{Enter}{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '<@all>', fileIds: [] });
  });

  it('@Every leads with Everyone, @zzz shows nothing and Enter sends', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), '@Every');
    expect((await screen.findAllByRole('option'))[0]).toHaveTextContent('Everyone in this group');
    await user.keyboard(' @zzz');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '@Every @zzz', fileIds: [] });
  });

  it('a typed @all is sent as <@all>, in code it stays text (filled or typed past the picker)', async () => {
    const user = userEvent.setup();
    const { onSubmit, ref } = await renderComposer();
    // Like Playwright's fill(): the text arrives without the picker.
    act(() => ref.current?.setMarkdown('@all hotovo `@all`'));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '<@all> hotovo `@all`', fileIds: [] });
  });

  it('a typed @Name of someone picked in the draft is sent as their token, others stay text', async () => {
    const user = userEvent.setup();
    const { onSubmit, ref } = await renderComposer();
    act(() => ref.current?.setMarkdown('<@jana> and @Jana Nováková, not @Peter Horváth'));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({
      body: '<@jana> and <@jana>, not @Peter Horváth',
      fileIds: [],
    });
  });

  it('one letter that starts an Everyone label does not offer Everyone', async () => {
    const user = userEvent.setup();
    await renderComposer();
    await user.type(box(), '@e');
    expect(screen.queryByText('Everyone in this group')).not.toBeInTheDocument();
  });

  it('Everyone in this group inserts @all and sends <@all>', async () => {
    const user = userEvent.setup();
    const { onSubmit } = await renderComposer();
    await user.type(box(), '@');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Everyone in this group');
    await user.click(options[0] as HTMLElement);
    expect(box()).toHaveTextContent('@all');
    await user.keyboard('now{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '<@all> now', fileIds: [] });
  });

  it('Escape closes the mention list without leaving the composer, typing reopens it', async () => {
    const user = userEvent.setup();
    await renderComposer();
    await user.type(box(), '@ja');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box()).toHaveFocus();
    await user.keyboard('n');
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('attaching a file shows a chip and send is disabled until the upload resolves', async () => {
    const user = userEvent.setup();
    let resolve!: (f: FileInfo) => void;
    upload.uploadFile.mockReturnValue(new Promise<FileInfo>((r) => (resolve = r)));
    const { onSubmit, container } = await renderComposer();
    await user.upload(fileInput(container), txt('plan.txt'));
    expect(screen.getByText('plan.txt')).toBeInTheDocument();
    expect(send()).toBeDisabled();
    resolve(info('f1'));
    await waitFor(() => expect(send()).toBeEnabled());
    await user.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ body: '', fileIds: ['f1'] });
  });

  it('a failed upload keeps its chip and blocks send until it is removed or retried', async () => {
    const user = userEvent.setup();
    upload.uploadFile.mockRejectedValueOnce(new Error('boom'));
    const { onSubmit, container } = await renderComposer();
    await user.type(box(), 'hello');
    await user.upload(fileInput(container), txt('big.txt'));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('big.txt')).toBeInTheDocument();
    expect(send()).toBeDisabled();
    upload.uploadFile.mockResolvedValueOnce(info('f9'));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send()).toBeEnabled());
    await user.click(send());
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hello', fileIds: ['f9'] });

    // Removing the failed chip also unblocks send.
    upload.uploadFile.mockRejectedValueOnce(new Error('boom'));
    await user.type(box(), 'again');
    await user.upload(fileInput(container), txt('bad.txt'));
    await screen.findByRole('button', { name: 'Try again' });
    expect(send()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(send()).toBeEnabled();
  });

  it('11th file shows At most 10 files', async () => {
    const user = userEvent.setup();
    upload.uploadFile.mockReturnValue(new Promise(() => undefined));
    const { container } = await renderComposer();
    const files = Array.from({ length: 11 }, (_, i) => txt(`f${i}.txt`));
    await user.upload(fileInput(container), files);
    expect(screen.getByText('At most 10 files per message.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove file' })).toHaveLength(10);
  });

  it('pasting an image uploads it', async () => {
    upload.uploadFile.mockResolvedValue(info('img'));
    await renderComposer();
    const image = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(box(), { clipboardData: { files: [image], getData: () => '' } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalledTimes(1));
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('files dropped on the drop target are uploaded', async () => {
    upload.uploadFile.mockResolvedValue(info('d1'));
    const zone = document.createElement('div');
    await renderComposer({ dropTarget: { current: zone } });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [txt('dropped.txt')] } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalledTimes(1));
    expect(screen.getByText('dropped.txt')).toBeInTheDocument();
  });

  it('reply strip shows the name and excerpt and × removes it', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const message = {
      id: 'm1',
      author: { id: 'jana', name: 'Jana Nováková', isAdmin: false },
      body: 'see <@peter> about it',
    } as MessageDto;
    await renderComposer({ mode: 'thread', replyTo: { message, onCancel } });
    expect(
      screen.getByText('Replying to Jana Nováková: see @Peter Horváth about it'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('sends replyToId with the reply strip', async () => {
    const user = userEvent.setup();
    const message = {
      id: 'm1',
      author: { id: 'jana', name: 'J', isAdmin: false },
      body: 'x',
    } as MessageDto;
    const { onSubmit } = await renderComposer({
      mode: 'thread',
      replyTo: { message, onCancel: vi.fn() },
    });
    await user.type(box(), 'yes{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'yes', fileIds: [], replyToId: 'm1' });
  });

  it('edit mode: Esc cancels, Enter saves', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { onSubmit } = await renderComposer({
      mode: 'edit',
      initialBody: 'hi <@jana>',
      onCancel,
    });
    expect(box()).toHaveTextContent('hi @Jana Nováková');
    expect(box()).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    // The edit box has the focus with the caret at the end, after the pill.
    await user.keyboard('!{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hi <@jana>!', fileIds: [] });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('edit mode opens the stored Markdown formatted and saves it unchanged', async () => {
    const user = userEvent.setup();
    const body = '**Plan**\n- one\n- `two`\n> note <@peter>';
    const { onSubmit } = await renderComposer({ mode: 'edit', initialBody: body });
    expect(box().querySelector('strong')).toHaveTextContent('Plan');
    expect(box().querySelectorAll('li')).toHaveLength(2);
    expect(box().querySelector('blockquote [data-mention="peter"]')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body, fileIds: [] });
  });

  it('edit mode shows an error when saving fails and allows another try', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    await renderComposer({ mode: 'edit', initialBody: 'a', onSubmit });
    await user.type(box(), 'b{Enter}');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('the mention picker lists clients and managers, not other admins', async () => {
    const user = userEvent.setup();
    await renderComposer();
    await user.type(box(), '@');
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Everyone in this group'),
      expect.stringContaining('Jana Nováková'),
      expect.stringContaining('Mira Kováčová'),
    ]);
    expect(screen.queryByRole('option', { name: /Peter/ })).toBeNull();
  });

  it('the Everyone row shows the clients-and-managers hint', async () => {
    const user = userEvent.setup();
    await renderComposer();
    await user.type(box(), '@');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveAccessibleName('Everyone in this group');
    expect(options[0]).toHaveAccessibleDescription("The group's clients and its eGrant managers");
  });

  it('an edit refused with invalid_mention keeps the text, shows the line and refetches people', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError('bad', 400, { error: 'invalid_mention' }));
    const { client } = await renderComposer({ mode: 'edit', initialBody: 'hi <@peter>', onSubmit });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.keyboard(' ok{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone you mentioned is no longer in this group.',
    );
    expect(box()).toHaveTextContent('hi @Peter Horváth ok');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: groupPeopleQuery('g1').queryKey });
  });

  it('opens the mention list below the field when editing and above it when writing', async () => {
    const user = userEvent.setup();
    const edit = await renderComposer({ mode: 'edit', initialBody: 'a' });
    await user.type(box(), ' @ja');
    expect(await screen.findByRole('listbox')).toHaveClass('top-full');
    edit.unmount();
    await renderComposer();
    await user.type(box(), '@ja');
    expect(await screen.findByRole('listbox')).toHaveClass('bottom-full');
  });

  it('shows a counter only above 9 000 characters and blocks sending past 10 000', async () => {
    const { ref } = await renderComposer();
    expect(screen.queryByText(/10 000 characters/)).toBeNull();
    act(() => ref.current?.setMarkdown('a'.repeat(10_001)));
    expect(screen.getByText(/10.?001 \/ 10 000 characters/)).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it('counts the stored body: mention tokens are longer than the names', async () => {
    const id = 'x'.repeat(36);
    const client = new QueryClient();
    client.setQueryData(groupPeopleQuery('g1').queryKey, [
      { id, name: 'Jo', isAdmin: false, isManager: false },
    ]);
    render(
      <QueryClientProvider client={client}>
        <Composer
          mode="edit"
          groupId="g1"
          initialBody={`${'a'.repeat(9_970)} <@${id}>`}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await field();
    // 9 974 characters as shown, 10 010 once stored.
    expect(screen.getByText(/10.?010 \/ 10 000 characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('the handle reads and replaces the draft, and the replacement can be undone', async () => {
    const user = userEvent.setup();
    const { ref, onSubmit } = await renderComposer();
    await user.type(box(), 'draft ');
    expect(ref.current?.getMarkdown()).toBe('draft ');
    act(() => ref.current?.setMarkdown('**Better** <@jana>'));
    expect(box().querySelector('strong')).toHaveTextContent('Better');
    expect(ref.current?.getMarkdown()).toBe('**Better** <@jana>');
    await user.keyboard('{Control>}z{/Control}');
    expect(ref.current?.getMarkdown()).toBe('draft ');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'draft', fileIds: [] });
  });

  it('on touch screens Enter adds a line', async () => {
    const user = userEvent.setup();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    const { onSubmit } = await renderComposer();
    await user.type(box(), 'a{Enter}b');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box().querySelectorAll('p')).toHaveLength(2);
    // @ts-expect-error restore the jsdom default (no matchMedia)
    delete window.matchMedia;
  });
});

describe('FormatToolbar alone (task description)', () => {
  it('has no Send and no attach, and no pressed state', () => {
    render(<FormatToolbar onFormat={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Bold' })).not.toHaveAttribute('aria-pressed');
  });
});

describe('Composer AI and voice tools (Phase 28)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows them next to Send for a channel, and the AI result replaces the draft', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).endsWith('/ai-tools')
          ? new Response(JSON.stringify({ text: true, translate: null, voice: true }))
          : new Response(JSON.stringify({ text: 'Fixed draft.' })),
      ),
    );
    const { ref } = await renderComposer({ channelId: 'c1' });
    await userEvent.type(box(), 'fixd **draft**');
    const inside = within(frame());
    expect(await inside.findByRole('button', { name: 'Dictate' })).toBeInTheDocument();
    await userEvent.click(inside.getByRole('button', { name: 'AI tools' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fix mistakes' }));
    // The AI reads the draft as Markdown, and its answer is rendered as Markdown again.
    await waitFor(() => expect(box()).toHaveTextContent('Fixed draft.'));
    const sent = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit?][]).find(
      ([url]) => String(url).endsWith('/ai-text'),
    );
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ text: 'fixd **draft**' });
    // One undo step brings the typed draft back.
    await userEvent.click(box());
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(ref.current?.getMarkdown()).toBe('fixd **draft**');
  });

  it('the edit composer has no AI or voice tools', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await renderComposer({ mode: 'edit', channelId: 'c1', initialBody: 'x' });
    expect(screen.queryByRole('button', { name: 'AI tools' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ai-tools'))).toBe(false);
  });
});
