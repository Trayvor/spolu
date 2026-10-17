import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';
import { toDoc, toMarkdown } from './markdown';

const names: Record<string, string> = { jana: 'Jana Nováková' };
const nameOf = (id: string) => names[id];
const LABELS = { all: '@all', unknown: '@unknown' };
const roundTrip = (md: string) => toMarkdown(toDoc(md, nameOf, LABELS));

const { nodes: n, marks: m } = schema;
const para = (...content: PMNode[]) => n.paragraph.create(null, content);
const txt = (text: string, ...marks: ReturnType<typeof m.bold.create>[]) =>
  schema.text(text, marks);
const doc = (...blocks: PMNode[]) => n.doc.create(null, blocks);

describe('toMarkdown(toDoc(md)) keeps what the composer writes', () => {
  it.each([
    ['plain text', 'hello world'],
    ['lines', 'one\ntwo\nthree'],
    ['a blank line', 'one\n\ntwo'],
    ['marks', '**bold** _italic_ ~~strike~~ `code`'],
    ['nested marks', '**bold _both_**'],
    ['a link', 'see [the docs](https://example.com/docs)'],
    ['a bold link', '[**docs**](https://example.com/)'],
    ['a bare URL', 'see https://example.com/a and go'],
    ['a bullet list', '- one\n- **two**'],
    ['an ordered list with its start', '3. three\n4. four'],
    ['a quote', '> quoted\n> lines'],
    ['a quote with a list', '> - a\n> - b'],
    ['a nested quote', '> outer\n> > inner'],
    ['a code block', '```\nconst a = 1;\n\nreturn **a**;\n```'],
    ['headings', '# One\n## Two\n### Three'],
    ['blocks after each other', 'intro\n- a\n- b\nafter\n> q\ntext'],
    ['mentions', 'hi <@jana> and <@all>!'],
    ['an unknown mention', 'hi <@ghost>'],
    ['a mention in bold', '**<@jana>**'],
    ['an empty body', ''],
  ])('%s', (_name, md) => {
    expect(roundTrip(md)).toBe(md);
  });
});

describe('toDoc', () => {
  it('turns every line of a paragraph into its own line', () => {
    expect(toDoc('a\nb', nameOf, LABELS).toJSON()).toEqual(
      doc(para(txt('a')), para(txt('b'))).toJSON(),
    );
  });

  it('gives mentions their names as labels', () => {
    const d = toDoc('<@jana> <@all> <@ghost>', nameOf, LABELS);
    const labels: string[] = [];
    d.descendants((node) => {
      if (node.type === n.mention) labels.push(node.attrs.label as string);
    });
    expect(labels).toEqual(['@Jana Nováková', '@all', '@unknown']);
  });

  it('normalises what the parser treats the same', () => {
    expect(roundTrip('- a\n\n\ntext')).toBe('- a\ntext');
    expect(roundTrip('one\n\n\n\ntwo')).toBe('one\n\ntwo');
    expect(roundTrip('**[docs](https://example.com/)**')).toBe('[**docs**](https://example.com/)');
  });
});

describe('toMarkdown', () => {
  it('moves spaces at the edge of a mark outside it', () => {
    const d = doc(para(txt('say '), txt('hi ', m.bold.create()), txt('now')));
    expect(toMarkdown(d)).toBe('say **hi** now');
  });

  it('closes and reopens marks so they nest', () => {
    const b = m.bold.create();
    const link = m.link.create({ href: 'https://x.sk/' });
    const d = doc(para(txt('a', b), txt('b', b, link), txt('c', b)));
    expect(toMarkdown(d)).toBe('**a**[**b**](https://x.sk/)**c**');
  });

  it('writes a hard break as a new line, and as a space in a list item or a heading', () => {
    const br = n.hard_break.create();
    const d = n.doc.create(null, [
      n.paragraph.create(null, [txt('a'), br, txt('b')]),
      n.bullet_list.create(null, [
        n.list_item.create(null, [n.paragraph.create(null, [txt('c'), br, txt('d')])]),
      ]),
      n.heading.create({ level: 2 }, [txt('e'), br, txt('f')]),
    ]);
    expect(toMarkdown(d)).toBe('a\nb\n- c d\n## e f');
  });

  it('writes an empty quote line as >', () => {
    const d = n.doc.create(null, [
      n.blockquote.create(null, [para(txt('a')), n.paragraph.create(), para(txt('b'))]),
    ]);
    expect(toMarkdown(d)).toBe('> a\n>\n> b');
  });
});
