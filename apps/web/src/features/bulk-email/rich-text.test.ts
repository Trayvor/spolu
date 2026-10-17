import { describe, expect, it } from 'vitest';
import { BulkBlockSchema, type BulkTextNode } from '@spolu/shared';
import { applyBoldShortcuts, domToNodes, nodesToEditorHtml, paletteKeyOf } from './rich-text';

const dom = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
};

describe('domToNodes', () => {
  it('reads the browser editing markup: marks, links, colour, headings, lists, alignment', () => {
    const nodes = domToNodes(
      dom(
        '<h2 style="text-align:center">Title</h2>' +
          '<p>a <b>bold</b> <i>it</i> <u>u</u> <strike>s</strike> <a href="https://egrant.sk">link</a> <font color="#7654ff">purple</font></p>' +
          '<ul><li>one</li><li style="text-align: right">two</li></ul>' +
          '<ol><li>first</li></ol><h3>Sub</h3>',
      ),
    );
    expect(nodes).toEqual([
      { type: 'h2', align: 'center', content: [{ text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { text: 'a ' },
          { text: 'bold', marks: ['bold'] },
          { text: ' ' },
          { text: 'it', marks: ['italic'] },
          { text: ' ' },
          { text: 'u', marks: ['underline'] },
          { text: ' ' },
          { text: 's', marks: ['strike'] },
          { text: ' ' },
          { text: 'link', href: 'https://egrant.sk' },
          { text: ' ' },
          { text: 'purple', color: 'purple' },
        ],
      },
      { type: 'bullet', content: [{ text: 'one' }] },
      { type: 'bullet', align: 'right', content: [{ text: 'two' }] },
      { type: 'ordered', content: [{ text: 'first' }] },
      { type: 'h3', content: [{ text: 'Sub' }] },
    ]);
  });

  it('text before the first block is a paragraph; <br> is a line break, a last one dropped', () => {
    expect(domToNodes(dom('Hello {{name}}<br>line<div>second<br></div><div><br></div>'))).toEqual([
      { type: 'paragraph', content: [{ text: 'Hello {{name}}\nline' }] },
      { type: 'paragraph', content: [{ text: 'second' }] },
    ]);
  });

  it('drops pasted junk: scripts, images, styles, unsafe links and off-palette colours', () => {
    const nodes = domToNodes(
      dom(
        '<p style="font-family:Comic Sans;background:red" onclick="x()">Keep<script>alert(1)</script>' +
          '<img src=x onerror="alert(1)"><a href="javascript:alert(1)">no link</a>' +
          '<span style="color:#ff0000">red text</span><span style="color: rgb(0, 122, 55)">green</span></p>' +
          '<table><tr><td>cell</td></tr></table><style>p{}</style>',
      ),
    );
    expect(nodes).toEqual([
      {
        type: 'paragraph',
        content: [{ text: 'Keepno linkred text' }, { text: 'green', color: 'green' }],
      },
      { type: 'paragraph', content: [{ text: 'cell' }] },
    ]);
    const block = { id: 't', type: 'text', align: 'left', content: nodes };
    expect(BulkBlockSchema.safeParse(block).success).toBe(true);
  });

  it('reads span styles (Google Docs paste) as marks', () => {
    expect(
      domToNodes(
        dom(
          '<p><span style="font-weight:700">B</span><span style="font-style:italic">I</span><span style="text-decoration:underline line-through">US</span></p>',
        ),
      ),
    ).toEqual([
      {
        type: 'paragraph',
        content: [
          { text: 'B', marks: ['bold'] },
          { text: 'I', marks: ['italic'] },
          { text: 'US', marks: ['underline', 'strike'] },
        ],
      },
    ]);
  });
});

describe('nodesToEditorHtml round trip', () => {
  it('reads back what it wrote', () => {
    const nodes: BulkTextNode[] = [
      { type: 'h2', align: 'center', content: [{ text: 'T' }] },
      {
        type: 'paragraph',
        content: [
          { text: 'a <b> & ' },
          { text: 'x', marks: ['bold', 'italic', 'underline', 'strike'], color: 'blue' },
          { text: 'l', href: 'mailto:a@b.sk' },
          { text: '\nnext' },
        ],
      },
      { type: 'bullet', content: [{ text: '1' }] },
      { type: 'bullet', content: [{ text: '2' }] },
      { type: 'ordered', align: 'right', content: [{ text: '3' }] },
    ];
    expect(domToNodes(dom(nodesToEditorHtml(nodes, 'left')))).toEqual(nodes);
  });

  it('an empty text is one empty paragraph to type in', () => {
    expect(nodesToEditorHtml([], 'left')).toBe('<p><br></p>');
  });

  it('the block alignment is written for nodes without their own', () => {
    expect(nodesToEditorHtml([{ type: 'paragraph', content: [{ text: 'x' }] }], 'center')).toBe(
      '<p style="text-align:center">x</p>',
    );
  });
});

describe('applyBoldShortcuts and paletteKeyOf', () => {
  it('**word** becomes bold; nothing else changes', () => {
    const nodes: BulkTextNode[] = [
      { type: 'paragraph', content: [{ text: 'Máme **novinky** pre vás' }] },
    ];
    expect(applyBoldShortcuts(nodes)).toEqual([
      {
        type: 'paragraph',
        content: [{ text: 'Máme ' }, { text: 'novinky', marks: ['bold'] }, { text: ' pre vás' }],
      },
    ]);
    const plain: BulkTextNode[] = [{ type: 'paragraph', content: [{ text: 'a ** b' }] }];
    expect(applyBoldShortcuts(plain)).toBe(plain);
  });

  it('maps only palette colours; ink is the default', () => {
    expect(paletteKeyOf('#3242DC')).toBe('blue');
    expect(paletteKeyOf('rgb(214, 0, 4)')).toBe('red');
    expect(paletteKeyOf('#141414')).toBeUndefined();
    expect(paletteKeyOf('red')).toBeUndefined();
    expect(paletteKeyOf('#E3DEDA')).toBeUndefined();
  });
});
