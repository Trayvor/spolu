import { describe, expect, it } from 'vitest';
// Shared with the server's extractMentions test (ruling P10); test data only, so a relative import.
import { MENTION_CASES } from '../../../../../../packages/shared/src/chat-mention-cases';
import { parseMessage, type Block, type Inline } from './parse';

const text = (t: string): Inline => ({ type: 'text', text: t });
const p = (...children: Inline[]): Block => ({ type: 'paragraph', children });
const bold = (...children: Inline[]): Inline => ({ type: 'bold', children });
const italic = (...children: Inline[]): Inline => ({ type: 'italic', children });
const strike = (...children: Inline[]): Inline => ({ type: 'strike', children });
const code = (t: string): Inline => ({ type: 'code', text: t });
const link = (href: string, ...children: Inline[]): Inline => ({ type: 'link', href, children });
const br: Inline = { type: 'break' };

const cases: [name: string, body: string, expected: Block[]][] = [
  ['plain text', 'hello world', [p(text('hello world'))]],
  ['bold', '**bold**', [p(bold(text('bold')))]],
  ['italic', 'an _italic_ word', [p(text('an '), italic(text('italic')), text(' word'))]],
  ['strike', '~~gone~~', [p(strike(text('gone')))]],
  ['code span', 'run `npm i`', [p(text('run '), code('npm i'))]],
  [
    'bold with italic inside',
    '**bold _italic_**',
    [p(bold(text('bold '), italic(text('italic'))))],
  ],
  [
    'italic with bold inside',
    '_italic **bold**_',
    [p(italic(text('italic '), bold(text('bold'))))],
  ],
  ['strike with bold inside', '~~a **b**~~', [p(strike(text('a '), bold(text('b'))))]],
  ['code span keeps marks literal', '`**not bold**`', [p(code('**not bold**'))]],
  [
    'a closer inside a code span does not count',
    '**a `b**` c**',
    [p(bold(text('a '), code('b**'), text(' c')))],
  ],
  ['unclosed marks stay text', '**open _open ~~open', [p(text('**open _open ~~open'))]],
  ['empty marks stay text', '**** __ ~~~~', [p(text('**** __ ~~~~'))]],
  ['snake_case stays text', 'snake_case_name', [p(text('snake_case_name'))]],
  ['dunder names stay text', '__init__ and __all__', [p(text('__init__ and __all__'))]],
  ['an underscore inside a word does not close italics', '_a_b c_', [p(italic(text('a_b c')))]],
  ['single stars stay text', '2*3*4 and *x*', [p(text('2*3*4 and *x*'))]],
  ['line breaks', 'one\ntwo', [p(text('one'), br, text('two'))]],
  ['blank line splits paragraphs', 'one\n\n\ntwo', [p(text('one')), p(text('two'))]],
  [
    'fenced block keeps lines and marks literal',
    '```\n**a**\n  _b_ <@u1>\n```\nafter',
    [{ type: 'codeBlock', text: '**a**\n  _b_ <@u1>' }, p(text('after'))],
  ],
  ['one-line fence', '```x = 1```', [{ type: 'codeBlock', text: 'x = 1' }]],
  [
    'language tag is dropped',
    '```js\nconst a = 1;\n```',
    [{ type: 'codeBlock', text: 'const a = 1;' }],
  ],
  ['language tag with symbols', '```c++\nx\n```', [{ type: 'codeBlock', text: 'x' }]],
  ['a first line of two words is code', '```a b\nx\n```', [{ type: 'codeBlock', text: 'a b\nx' }]],
  ['a lone word in a one-line fence is code', '```js```', [{ type: 'codeBlock', text: 'js' }]],
  ['unclosed fence runs to the end', '```\na\n\nb', [{ type: 'codeBlock', text: 'a\n\nb' }]],
  [
    'inline fence in a paragraph',
    'see ```a\nb``` ok',
    [p(text('see '), code('a\nb'), text(' ok'))],
  ],
  [
    'quote with a list inside',
    '> intro\n> - one\n> - **two**\nafter',
    [
      {
        type: 'quote',
        children: [
          p(text('intro')),
          { type: 'list', ordered: false, start: 1, items: [[text('one')], [bold(text('two'))]] },
        ],
      },
      p(text('after')),
    ],
  ],
  [
    'nested quote',
    '> > deep',
    [{ type: 'quote', children: [{ type: 'quote', children: [p(text('deep'))] }] }],
  ],
  ['quote marker without a space is text', '>no', [p(text('>no'))]],
  [
    'bullet list',
    '- a\n- b',
    [{ type: 'list', ordered: false, start: 1, items: [[text('a')], [text('b')]] }],
  ],
  [
    'ordered list starting at 3',
    '3. three\n4. four\n9. nine',
    [
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [[text('three')], [text('four')], [text('nine')]],
      },
    ],
  ],
  [
    'a list ends a paragraph and a blank line ends the list',
    'intro\n- a\n\n- b',
    [
      p(text('intro')),
      { type: 'list', ordered: false, start: 1, items: [[text('a')]] },
      { type: 'list', ordered: false, start: 1, items: [[text('b')]] },
    ],
  ],
  [
    'bare URL with a trailing period',
    'see https://example.com/a.',
    [p(text('see '), link('https://example.com/a', text('https://example.com/a')), text('.'))],
  ],
  [
    'URL with _ and a balanced )',
    '(https://en.wikipedia.org/wiki/Foo_(bar)_baz), ok',
    [
      p(
        text('('),
        link(
          'https://en.wikipedia.org/wiki/Foo_(bar)_baz',
          text('https://en.wikipedia.org/wiki/Foo_(bar)_baz'),
        ),
        text('), ok'),
      ),
    ],
  ],
  [
    'URL inside bold',
    '**http://example.com/x**',
    [p(bold(link('http://example.com/x', text('http://example.com/x'))))],
  ],
  ['mailto', 'mailto:a@b.sk!', [p(link('mailto:a@b.sk', text('mailto:a@b.sk')), text('!'))]],
  ['no URL inside a word', 'xhttp://example.com', [p(text('xhttp://example.com'))]],
  [
    'markdown link',
    'go [the **site**](https://example.com/a_(b)) now',
    [
      p(
        text('go '),
        link('https://example.com/a_(b)', text('the '), bold(text('site'))),
        text(' now'),
      ),
    ],
  ],
  [
    'javascript: link stays literal',
    '[x](javascript:alert(1))',
    [p(text('[x](javascript:alert(1))'))],
  ],
  [
    'data: link stays literal',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
    [p(text('[x](data:text/html;base64,PHNjcmlwdD4=)'))],
  ],
  ['vbscript: link stays literal', '[x](vbscript:msgbox)', [p(text('[x](vbscript:msgbox)'))]],
  [
    'tab-obfuscated scheme stays literal',
    '[x](java\tscript:alert(1))',
    [p(text('[x](java\tscript:alert(1))'))],
  ],
  ['bare javascript: stays text', 'javascript:alert(1)', [p(text('javascript:alert(1)'))]],
  [
    'an invalid bare URL stays text',
    'see https://[oops and **b**',
    [p(text('see https://[oops and '), bold(text('b')))],
  ],
  [
    'a bare URL over 2048 characters stays text',
    `https://x.sk/${'a'.repeat(2048)}`,
    [p(text(`https://x.sk/${'a'.repeat(2048)}`))],
  ],
  [
    'mention and @all tokens',
    'hi <@u1>, <@all>!',
    [
      p(
        text('hi '),
        { type: 'mention', userId: 'u1' },
        text(', '),
        { type: 'mentionAll' },
        text('!'),
      ),
    ],
  ],
  ['HTML comes back as text', '<b>hi</b>', [p(text('<b>hi</b>'))]],
  [
    'img tag comes back as text',
    '<img src=x onerror=alert(1)>',
    [p(text('<img src=x onerror=alert(1)>'))],
  ],
  ['empty body', '', []],
  ['CRLF line ends', 'a\r\nb', [p(text('a'), br, text('b'))]],
];

describe('parseMessage', () => {
  it.each(cases)('%s', (_name, body, expected) => {
    expect(parseMessage(body)).toEqual(expected);
  });

  it.each(MENTION_CASES)('shared mention case %#: $body', ({ body, userIds, all }) => {
    const found = new Set<string>();
    let foundAll = false;
    const walkInline = (nodes: Inline[]) => {
      for (const n of nodes) {
        if (n.type === 'mention') found.add(n.userId);
        else if (n.type === 'mentionAll') foundAll = true;
        else if ('children' in n) walkInline(n.children);
      }
    };
    const walk = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.type === 'paragraph') walkInline(b.children);
        else if (b.type === 'quote') walk(b.children);
        else if (b.type === 'list') b.items.forEach(walkInline);
      }
    };
    walk(parseMessage(body));
    expect({ userIds: [...found], all: foundAll }).toEqual({ userIds, all });
  });

  // Bodies are capped at 10 000 characters; 10x that makes any quadratic step take seconds
  // (a linear parse of each input takes a few milliseconds), so the bound is far from flaky.
  it('stays linear on hostile input (100 000 characters each)', () => {
    const n = 100_000;
    const inputs = [
      '*'.repeat(n),
      '_'.repeat(n),
      '~'.repeat(n),
      '`'.repeat(n),
      '>'.repeat(n),
      '> '.repeat(n / 2),
      '['.repeat(n),
      '[a]('.repeat(n / 4),
      '**a _b ~~c '.repeat(n / 11),
      '_a '.repeat(n / 3),
      'a_ '.repeat(n / 3),
      '` x'.repeat(n / 3),
      '(https://x.y/'.repeat(n / 13),
      '(https://['.repeat(n / 10),
      ' https://['.repeat(n / 10),
      '(mailto:%'.repeat(n / 9),
      'xhttps://'.repeat(n / 9),
      'https://' + 'a'.repeat(n),
      'https://x.y/' + ')'.repeat(n),
      '- '.repeat(n / 2),
      '1. '.repeat(n / 3),
      '<@u1>'.repeat(n / 5),
      '```\n'.repeat(n / 4),
      'a\n'.repeat(n / 2),
    ];
    // A generous bound, so a loaded machine does not fail it: a quadratic scan of 100 000
    // characters takes many seconds, a linear one a few milliseconds.
    for (const input of inputs) {
      const started = performance.now();
      parseMessage(input);
      expect(performance.now() - started, input.slice(0, 12)).toBeLessThan(2000);
    }
  });
});
