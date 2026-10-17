import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import { toMarkdown } from './markdown';
import {
  activeFormats,
  createState,
  insertMention,
  mentionAt,
  newLine,
  pastesAsMarkdown,
  setLink,
  toggleFormat,
  type EditorOptions,
} from './setup';

const names: Record<string, string> = { jana: 'Jana Nováková' };
let view: EditorView | null = null;

function setup(md = '', options: Partial<EditorOptions> = {}) {
  const onEnter = vi.fn(() => true);
  const full: EditorOptions = {
    nameOf: (id) => names[id],
    labels: { all: '@all', unknown: '@unknown' },
    placeholder: 'Write a message…',
    onEnter,
    ...options,
  };
  view = new EditorView(document.createElement('div'), { state: createState(md, full) });
  const v = view;
  // Caret at the end.
  v.dispatch(v.state.tr.setSelection(TextSelection.atEnd(v.state.doc)));
  return { view: v, onEnter, md: () => toMarkdown(v.state.doc) };
}

/** Types like a person: every character goes through the input rules first. */
function type(v: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = v.state.selection;
    const deflt = () => v.state.tr.insertText(ch, from, to);
    const handled = v.someProp('handleTextInput', (f) => f(v, from, to, ch, deflt));
    if (!handled) v.dispatch(deflt());
  }
}

function key(v: EditorView, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, cancelable: true, ...init });
  v.someProp('handleKeyDown', (f) => f(v, event));
}

const run = (
  v: EditorView,
  command: (s: EditorView['state'], d: EditorView['dispatch']) => boolean,
) => command(v.state, v.dispatch);

afterEach(() => {
  view?.destroy();
  view = null;
});

describe('Markdown shortcuts while typing', () => {
  it.each([
    ['**bold**', 'x **bold** y', 'strong'],
    ['_italic_', 'x _italic_ y', 'em'],
    ['~~strike~~', 'x ~~strike~~ y', 's'],
    ['`code`', 'x `code` y', 'code'],
  ])('%s becomes formatting at once', (_name, typed, tag) => {
    const { view: v, md } = setup();
    type(v, typed);
    expect(v.dom.querySelector(tag)?.textContent).toBe(typed.split(' ')[1]!.replace(/[*_~`]/g, ''));
    expect(md()).toBe(typed);
  });

  it('the mark does not continue after the closing characters', () => {
    const { view: v } = setup();
    type(v, '**a** b');
    expect(v.dom.querySelector('strong')?.textContent).toBe('a');
  });

  it('snake_case stays text', () => {
    const { view: v, md } = setup();
    type(v, 'my_var_name_ ');
    expect(v.dom.querySelector('em')).toBeNull();
    expect(md()).toBe('my_var_name_ ');
  });

  it('[text](url) becomes a link, an unsafe address stays text', () => {
    const { view: v, md } = setup();
    type(v, 'see [docs](https://x.sk/a) and [bad](javascript:alert)');
    expect(v.dom.querySelectorAll('a')).toHaveLength(1);
    expect(v.dom.querySelector('a')).toHaveAttribute('href', 'https://x.sk/a');
    expect(md()).toBe('see [docs](https://x.sk/a) and [bad](javascript:alert)');
  });

  it.each([
    ['- ', 'ul'],
    ['* ', 'ul'],
    ['1. ', 'ol'],
    ['> ', 'blockquote'],
    ['# ', 'h3'],
    ['## ', 'h4'],
    ['### ', 'h5'],
    ['```', 'pre'],
  ])('%s at the start of a line makes a block', (typed, tag) => {
    const { view: v } = setup();
    type(v, typed);
    expect(v.dom.querySelector(tag)).not.toBeNull();
  });

  it('a list keeps its typed start number', () => {
    const { view: v, md } = setup();
    type(v, '3. three');
    expect(md()).toBe('3. three');
  });

  it('nothing is converted inside a code block or inline code', () => {
    const { view: v, md } = setup('```\n\n```');
    type(v, '**a** - ');
    expect(md()).toBe('```\n**a** - \n```');
  });

  it('Backspace right after a shortcut brings the characters back', () => {
    const { view: v, md } = setup();
    type(v, '- ');
    key(v, 'Backspace');
    expect(v.dom.querySelector('ul')).toBeNull();
    expect(md()).toBe('- ');
  });

  it('Backspace at the start of a heading makes it a plain line', () => {
    const { view: v, md } = setup('## Title');
    v.dispatch(v.state.tr.setSelection(TextSelection.atStart(v.state.doc)));
    key(v, 'Backspace');
    expect(md()).toBe('Title');
  });
});

describe('Enter and new lines', () => {
  it('Enter calls onEnter (the composer sends) and changes nothing', () => {
    const { view: v, onEnter, md } = setup('hello');
    key(v, 'Enter');
    expect(onEnter).toHaveBeenCalled();
    expect(md()).toBe('hello');
  });

  it('Shift+Enter starts a new line', () => {
    const { view: v, onEnter, md } = setup('hello');
    key(v, 'Enter', { shiftKey: true });
    type(v, 'world');
    expect(onEnter).not.toHaveBeenCalled();
    expect(md()).toBe('hello\nworld');
  });

  it('a new line in a list starts the next item, an empty item leaves the list', () => {
    const { view: v, md } = setup('- one');
    run(v, newLine);
    type(v, 'two');
    run(v, newLine);
    run(v, newLine);
    type(v, 'after');
    expect(md()).toBe('- one\n- two\nafter');
  });

  it('a new line in a code block adds a line, an empty last line leaves the block', () => {
    const { view: v, md } = setup('```\na\n```');
    run(v, newLine);
    type(v, 'b');
    run(v, newLine);
    run(v, newLine);
    type(v, 'text');
    expect(md()).toBe('```\na\nb\n```\ntext');
  });

  it('an empty line in a quote leaves the quote', () => {
    const { view: v, md } = setup('> q');
    run(v, newLine);
    run(v, newLine);
    type(v, 'out');
    expect(md()).toBe('> q\nout');
  });

  it('a new line after a heading is a plain line', () => {
    const { view: v, md } = setup('# Title');
    run(v, newLine);
    type(v, 'text');
    expect(md()).toBe('# Title\ntext');
  });
});

describe('toolbar commands', () => {
  const selectAll = (v: EditorView) =>
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1)),
    );

  it('bold, italic, strike and code toggle on the selection', () => {
    const { view: v, md } = setup('hi');
    selectAll(v);
    run(v, toggleFormat('bold'));
    expect(md()).toBe('**hi**');
    expect(activeFormats(v.state).has('bold')).toBe(true);
    run(v, toggleFormat('bold'));
    expect(md()).toBe('hi');
  });

  it('lists and quotes wrap the line and unwrap it again', () => {
    const { view: v, md } = setup('item');
    run(v, toggleFormat('bulletList'));
    expect(md()).toBe('- item');
    expect(activeFormats(v.state).has('bulletList')).toBe(true);
    run(v, toggleFormat('numberedList'));
    expect(md()).toBe('1. item');
    run(v, toggleFormat('numberedList'));
    expect(md()).toBe('item');
    run(v, toggleFormat('quote'));
    expect(md()).toBe('> item');
    run(v, toggleFormat('quote'));
    expect(md()).toBe('item');
  });

  it('setLink links the selection, or inserts the address when nothing is selected', () => {
    const { view: v, md } = setup('docs');
    selectAll(v);
    run(v, setLink('https://x.sk/a'));
    expect(md()).toBe('[docs](https://x.sk/a)');
    v.dispatch(v.state.tr.setSelection(TextSelection.atEnd(v.state.doc)));
    type(v, ' ');
    run(v, setLink('https://y.sk/'));
    expect(md()).toBe('[docs](https://x.sk/a) https://y.sk/');
  });
});

describe('mentions', () => {
  it('mentionAt finds the @query before the caret', () => {
    const { view: v } = setup();
    type(v, 'hi @ja');
    expect(mentionAt(v.state)).toEqual({ query: 'ja', from: 4, to: 7 });
    type(v, ' ');
    expect(mentionAt(v.state)).toBeNull();
  });

  it('insertMention replaces the query with a pill and a space', () => {
    const { view: v, md } = setup();
    type(v, 'hi @ja');
    const found = mentionAt(v.state)!;
    run(v, insertMention(found, 'jana', '@Jana Nováková'));
    type(v, 'ok');
    expect(v.dom.querySelector('[data-mention="jana"]')?.textContent).toBe('@Jana Nováková');
    expect(md()).toBe('hi <@jana> ok');
  });

  it('a pill is one character for Backspace', () => {
    const { view: v, md } = setup('hi <@jana>');
    key(v, 'Backspace');
    expect(md()).toBe('hi ');
  });
});

describe('placeholder', () => {
  it('shows on an empty draft only', () => {
    const { view: v } = setup();
    expect(v.dom.querySelector('[data-placeholder="Write a message…"]')).not.toBeNull();
    type(v, 'a');
    expect(v.dom.querySelector('[data-placeholder]')).toBeNull();
  });
});

// jsdom has no ClipboardEvent; an event without clipboardData takes the editor's default path.
const fakePaste = () => new Event('paste') as ClipboardEvent;

describe('paste', () => {
  it('plain Markdown text renders', () => {
    const { view: v, md } = setup();
    v.pasteText('# Plan\n- **one**\n- two', fakePaste());
    expect(v.dom.querySelector('h3')?.textContent).toBe('Plan');
    expect(v.dom.querySelector('li strong')?.textContent).toBe('one');
    expect(md()).toBe('# Plan\n- **one**\n- two');
  });

  it('HTML with formatting is kept as HTML; editor or bare HTML falls back to the Markdown text', () => {
    expect(pastesAsMarkdown('')).toBe(true);
    expect(pastesAsMarkdown('<meta charset="utf-8"><span>**a**</span>')).toBe(true);
    expect(pastesAsMarkdown('<div><span style="color:red">x</span></div>')).toBe(true);
    expect(pastesAsMarkdown('<p>a <strong>b</strong></p>')).toBe(false);
    expect(pastesAsMarkdown('<ul><li>a</li></ul>')).toBe(false);
    expect(pastesAsMarkdown('<p data-pm-slice="1 1 []">a</p>')).toBe(false);
  });

  it('pasted HTML keeps the supported formatting', () => {
    const { view: v, md } = setup();
    v.pasteHTML(
      '<p>a <strong>b</strong> <a href="https://x.sk/">c</a> <span style="color:red">d</span></p>',
      fakePaste(),
    );
    expect(md()).toBe('a **b** [c](https://x.sk/) d');
  });

  it('Markdown copied from a code editor (HTML of plain spans) renders from its text', () => {
    const { view: v, md } = setup();
    const data: Record<string, string> = {
      'text/plain': '**bold** and _it_',
      'text/html': '<div><span style="color:#333">**bold** and _it_</span></div>',
    };
    const event = { clipboardData: { getData: (t: string) => data[t] ?? '', files: [] } };
    v.someProp('handlePaste', (f) => f(v, event as unknown as ClipboardEvent, Slice.empty));
    expect(v.dom.querySelector('strong')?.textContent).toBe('bold');
    expect(md()).toBe('**bold** and _it_');
  });

  it('pasted images without text go to onPasteFiles', () => {
    const onPasteFiles = vi.fn();
    const { view: v } = setup('', { onPasteFiles });
    const image = new File(['x'], 'shot.png', { type: 'image/png' });
    const event = { clipboardData: { getData: () => '', files: [image] } };
    v.someProp('handlePaste', (f) => f(v, event as unknown as ClipboardEvent, Slice.empty));
    expect(onPasteFiles).toHaveBeenCalledWith([image]);
  });
});
