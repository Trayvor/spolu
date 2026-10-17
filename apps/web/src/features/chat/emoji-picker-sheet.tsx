import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { EMOJI_GROUPS } from './emoji-data';

/**
 * The full reaction picker (Phase 28, a lazy chunk): the curated emoji in groups, in a bottom
 * sheet on phones and a 420 px sheet at the bottom centre on wider screens.
 */
export default function EmojiPickerSheet({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      label={t('chat.reactions.pickerTitle')}
      onClose={onClose}
      className="min-[641px]:left-1/2 min-[641px]:-ml-[210px] min-[641px]:w-[420px] min-[641px]:max-h-[60dvh]"
    >
      <div className="flex flex-col gap-3 px-2 pb-2">
        {EMOJI_GROUPS.map((group) => (
          <section key={group.key} aria-label={t(`chat.reactions.groups.${group.key}`)}>
            <h3 className="px-1 pb-1 text-micro font-semibold text-muted-foreground">
              {t(`chat.reactions.groups.${group.key}`)}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))]">
              {group.emoji.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={t('chat.reactions.react', { emoji })}
                  onClick={() => onPick(emoji)}
                  className="inline-flex size-11 items-center justify-center rounded-lg text-[22px] leading-none hover:bg-accent focus-visible:bg-accent"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </BottomSheet>
  );
}
