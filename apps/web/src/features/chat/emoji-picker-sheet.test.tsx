import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n, setLanguage } from '@/i18n';
import EmojiPickerSheet from './emoji-picker-sheet';

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

beforeEach(() => {
  setLanguage('en');
  localStorage.clear();
});

describe('the emoji picker', () => {
  it('shows the flowers and, once something was picked, a frequently used group first', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const first = render(<EmojiPickerSheet onPick={onPick} onClose={() => {}} />);
    expect(screen.queryByRole('region', { name: t('chat.reactions.groups.frequent') })).toBeNull();
    const flowers = screen.getByRole('region', { name: t('chat.reactions.groups.flowers') });
    await user.click(
      within(flowers).getByRole('button', { name: t('chat.reactions.react', { emoji: '🌷' }) }),
    );
    expect(onPick).toHaveBeenCalledWith('🌷');
    first.unmount();

    render(<EmojiPickerSheet onPick={onPick} onClose={() => {}} />);
    const regions = screen.getAllByRole('region');
    expect(regions[0]).toHaveAccessibleName(t('chat.reactions.groups.frequent'));
    expect(
      within(regions[0]!)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['🌷']);
  });
});
