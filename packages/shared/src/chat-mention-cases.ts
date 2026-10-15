/**
 * Test data only (not exported from the package index): bodies and the mentions they carry.
 * The server's `extractMentions` and the web's `parseMessage` both run these cases, so the
 * people the server notifies are exactly the people the UI shows as mention pills.
 */
export const MENTION_CASES: { body: string; userIds: string[]; all: boolean }[] = [
  { body: 'hi <@u1> and <@all>', userIds: ['u1'], all: true },
  { body: '<@u1><@u2> <@u1>', userIds: ['u1', 'u2'], all: false },
  { body: 'no mentions <@ u1> <@> <@u1', userIds: [], all: false },
  { body: '`<@u1>` and <@u2>', userIds: ['u2'], all: false },
  { body: '```\n<@u1> <@all>\n```\n<@u2>', userIds: ['u2'], all: false },
  { body: 'text\n```\n<@u1>\n', userIds: [], all: false },
  { body: 'mid ```x <@u1>``` <@u2>', userIds: ['u2'], all: false },
  { body: '> quoted <@u1>\n> - item <@u2>', userIds: ['u1', 'u2'], all: false },
  { body: '- a <@u1>\n3. b <@u2>\n\n<@all>', userIds: ['u1', 'u2'], all: true },
  { body: '**<@u1>** _<@u2>_ ~~<@u3>~~', userIds: ['u1', 'u2', 'u3'], all: false },
  {
    body: '[hey <@u1>](https://example.com) https://example.com/<@u2>',
    userIds: ['u1', 'u2'],
    all: false,
  },
  { body: '<@a_b-c_>_ and _<@x_>_', userIds: ['a_b-c_', 'x_'], all: false },
];
