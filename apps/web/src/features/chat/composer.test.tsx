import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FileInfo, GroupPerson, MessageDto } from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { groupPeopleQuery } from '@/features/groups/api';
import { Composer, type ComposerProps } from './composer';

const upload = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock('@/features/files/upload', () => upload);

const people: GroupPerson[] = [
  { id: 'jana', name: 'Jana Nováková', isAdmin: false },
  { id: 'peter', name: 'Peter Horváth', isAdmin: true },
];

function renderComposer(props: Partial<ComposerProps> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  const client = new QueryClient();
  client.setQueryData(groupPeopleQuery('g1').queryKey, people);
  const view = render(
    <QueryClientProvider client={client}>
      <Composer mode="new" groupId="g1" {...props} onSubmit={onSubmit} />
    </QueryClientProvider>,
  );
  return { onSubmit: onSubmit as ReturnType<typeof vi.fn>, ...view };
}

const box = () => screen.getByRole('textbox');
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
  it('Enter sends, Shift+Enter adds a line', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    await user.type(box(), 'hello{Shift>}{Enter}{/Shift}world');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box()).toHaveValue('hello\nworld');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hello\nworld', fileIds: [] });
    expect(box()).toHaveValue('');
  });

  it('Cmd/Ctrl+B wraps the selection in **', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), 'say hi now');
    (box() as HTMLTextAreaElement).setSelectionRange(4, 6);
    await user.keyboard('{Control>}b{/Control}');
    expect(box()).toHaveValue('say **hi** now');
  });

  it('the toolbar offers every format with a label', async () => {
    const user = userEvent.setup();
    renderComposer();
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
    await user.click(screen.getByRole('button', { name: 'Code' }));
    expect(box()).toHaveValue('``');
  });

  it('typing @ja shows Jana, ArrowDown + Enter inserts @Jana Nováková and sends <@id>', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    await user.type(box(), 'hi @ja');
    expect(await screen.findByRole('option', { name: /Jana Nováková/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Peter/ })).toBeNull();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(box()).toHaveValue('hi @Jana Nováková ');
    await user.keyboard('ok{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hi <@jana> ok', fileIds: [] });
  });

  it('@ja + Enter picks the person, never Everyone', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    await user.type(box(), '@ja{Enter}');
    expect(box()).toHaveValue('@Jana Nováková ');
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '<@jana>', fileIds: [] });
  });

  it('@ + Enter picks Everyone only when nothing else is typed', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), '@{Enter}');
    expect(box()).toHaveValue('@all ');
  });

  it('@all and @every lead with Everyone, @zzz shows nothing and Enter sends', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    await user.type(box(), '@Every');
    expect((await screen.findAllByRole('option'))[0]).toHaveTextContent('Everyone in this group');
    await user.clear(box());
    await user.type(box(), '@zzz{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith({ body: '@zzz', fileIds: [] });
  });

  it('one letter that starts an Everyone label does not offer Everyone', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), '@e');
    expect(screen.queryByText('Everyone in this group')).not.toBeInTheDocument();
  });

  it('Everyone in this group inserts @all and sends <@all>', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer();
    await user.type(box(), '@');
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Everyone in this group');
    await user.click(options[0] as HTMLElement);
    expect(box()).toHaveValue('@all ');
    await user.keyboard('now{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: '<@all> now', fileIds: [] });
  });

  it('Escape closes the mention list without leaving the composer', async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(box(), '@ja{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('attaching a file shows a chip and send is disabled until the upload resolves', async () => {
    const user = userEvent.setup();
    let resolve!: (f: FileInfo) => void;
    upload.uploadFile.mockReturnValue(new Promise<FileInfo>((r) => (resolve = r)));
    const { onSubmit, container } = renderComposer();
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
    const { onSubmit, container } = renderComposer();
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
    const { container } = renderComposer();
    const files = Array.from({ length: 11 }, (_, i) => txt(`f${i}.txt`));
    await user.upload(fileInput(container), files);
    expect(screen.getByText('At most 10 files per message.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remove file' })).toHaveLength(10);
  });

  it('pasting an image uploads it', async () => {
    upload.uploadFile.mockResolvedValue(info('img'));
    renderComposer();
    const image = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(box(), { clipboardData: { files: [image] } });
    await waitFor(() => expect(upload.uploadFile).toHaveBeenCalledTimes(1));
    expect(screen.getByText('shot.png')).toBeInTheDocument();
  });

  it('files dropped on the drop target are uploaded', async () => {
    upload.uploadFile.mockResolvedValue(info('d1'));
    const zone = document.createElement('div');
    renderComposer({ dropTarget: { current: zone } });
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
    renderComposer({ mode: 'thread', replyTo: { message, onCancel } });
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
    const { onSubmit } = renderComposer({
      mode: 'thread',
      replyTo: { message, onCancel: vi.fn() },
    });
    await user.type(box(), 'yes{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'yes', fileIds: [], replyToId: 'm1' });
  });

  it('edit mode: Esc cancels, Enter saves', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { onSubmit } = renderComposer({
      mode: 'edit',
      initialBody: 'hi <@jana>',
      onCancel,
    });
    expect(box()).toHaveValue('hi @Jana Nováková');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    await user.type(box(), '!{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'hi <@jana>!', fileIds: [] });
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('edit mode does not open the mention list on mount and saves a trailing mention unchanged', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderComposer({ mode: 'edit', initialBody: 'ok <@peter>' });
    expect(box()).toHaveValue('ok @Peter Horváth');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(box(), '!{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'ok <@peter>!', fileIds: [] });
  });

  it('a single-word mention at the end is not replaced by Enter', async () => {
    const user = userEvent.setup();
    const client = new QueryClient();
    client.setQueryData(groupPeopleQuery('g1').queryKey, [
      { id: 'p', name: 'Peter', isAdmin: false },
    ]);
    const onSubmit = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <Composer mode="edit" groupId="g1" initialBody="thanks <@p>" onSubmit={onSubmit} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ body: 'thanks <@p>', fileIds: [] });
  });

  it('edit mode shows an error when saving fails and allows another try', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    renderComposer({ mode: 'edit', initialBody: 'a', onSubmit });
    await user.type(box(), 'b{Enter}');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('opens the mention list below the field when editing and above it when writing', async () => {
    const user = userEvent.setup();
    const edit = renderComposer({ mode: 'edit', initialBody: 'a' });
    await user.type(box(), ' @ja');
    expect(await screen.findByRole('listbox')).toHaveClass('top-full');
    edit.unmount();
    renderComposer();
    await user.type(box(), '@ja');
    expect(await screen.findByRole('listbox')).toHaveClass('bottom-full');
  });

  it('shows a counter only above 9 000 characters and blocks sending past 10 000', () => {
    renderComposer();
    expect(screen.queryByText(/10 000 characters/)).toBeNull();
    fireEvent.change(box(), { target: { value: 'a'.repeat(10_001) } });
    expect(screen.getByText(/10.?001 \/ 10 000 characters/)).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it('counts the stored body: mention tokens are longer than the names', () => {
    const id = 'x'.repeat(36);
    const client = new QueryClient();
    client.setQueryData(groupPeopleQuery('g1').queryKey, [{ id, name: 'Jo', isAdmin: false }]);
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
    // 9 974 characters as typed, 10 010 once stored.
    expect(screen.getByText(/10.?010 \/ 10 000 characters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('on touch screens Enter adds a line', async () => {
    const user = userEvent.setup();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    const { onSubmit } = renderComposer();
    await user.type(box(), 'a{Enter}b');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(box()).toHaveValue('a\nb');
    // @ts-expect-error restore the jsdom default (no matchMedia)
    delete window.matchMedia;
  });
});
