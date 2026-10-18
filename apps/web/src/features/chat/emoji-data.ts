/**
 * The reaction picker's emoji (Phase 28): a curated set of common ones in groups, kept small so
 * the picker's lazy chunk stays a few kB. No search and no skin tones: the quick row covers most
 * reactions, this covers the rest. The sheet puts the person's frequently used ones first
 * (`emoji-usage.ts`). Symbols that default to text carry U+FE0F. Group names are
 * `chat.reactions.groups.<key>`.
 */
const split = (text: string): string[] =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
    (s) => s.segment,
  );

export const EMOJI_GROUPS: { key: string; emoji: string[] }[] = [
  {
    key: 'smileys',
    emoji: split(
      '😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😛😜🤪🤗🤭🤫🤔🤐🤨😐😑😶😏😒🙄😬😌😔😪😴😷🤒🤕🤢🥵🥶🥴🤯🤠🥳😎🤓🧐😕😟🙁😮😯😲😳🥺😦😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬',
    ),
  },
  {
    key: 'gestures',
    emoji: split('👍👎👌✌️🤞🤟🤘🤙👈👉👆👇☝️✋🤚🖐️🖖👋👏🙌👐🤲🤝🙏💪✍️'),
  },
  { key: 'hearts', emoji: split('❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💖💯') },
  { key: 'flowers', emoji: split('💐🌸💮🏵️🌹🥀🌺🌻🌼🌷🪷🪻🌱🪴🌿☘️🍁🍂🍃🌵🌴🌳🌲') },
  {
    key: 'work',
    emoji: split('📄📑📊📈📉📅📆📌📎✏️📝📁📂📋📧📨📞💻🖨️🔍🔒🔑💡⏰⌛💰💶🧾🏦🏛️'),
  },
  { key: 'celebration', emoji: split('🎉🎊🎁🏆🥇🎯🚀⭐🌟✨🔥⚡🍀🌈☀️🎂🍾🥂☕🍕') },
  {
    key: 'symbols',
    emoji: split('✅☑️✔️❌❎⚠️❗❓‼️⁉️➕➖🆗🆕🔴🟠🟡🟢🔵🟣⏳🔁👀💬'),
  },
];
