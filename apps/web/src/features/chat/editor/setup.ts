import {
  baseKeymap,
  chainCommands,
  lift,
  setBlockType,
  splitBlock,
  toggleMark,
  wrapIn,
} from 'prosemirror-commands';
import { closeHistory, history, redo, undo } from 'prosemirror-history';
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Slice, type MarkType, type Node, type NodeType } from 'prosemirror-model';
import { liftListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import {
  EditorState,
  Plugin,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { mentionQueryAt, type FormatKind } from '../composer-text';
import { safeHref } from '../format/parse';
import { toDoc, toMarkdown, type MentionLabels } from './markdown';
import { schema } from './schema';

const { nodes, marks } = schema;

/**
 * What the editor needs from the composer. The object is read on every use, so the composer can
 * update `nameOf` (the people load later) without recreating the editor.
 */
export interface EditorOptions {
  nameOf(id: string): string | undefined;
  labels: MentionLabels;
  placeholder: string;
  /** Enter without Shift: true when the composer used it (sent); false makes it a new line. */
  onEnter(): boolean;
  /** Images pasted without any text; absent where files cannot be attached (edit mode). */
  onPasteFiles?(files: File[]): void;
}

// ---------------------------------------------------------------------------------------------
// Markdown shortcuts

/**
 * `**x**`-style shortcuts: group 1 is the character before the opening marker (or nothing at the
 * line start), group 2 the text. The last character of the match is the one being typed, which
 * is not in the document yet.
 */
function markRule(pattern: RegExp, type: MarkType, marker: string): InputRule {
  return new InputRule(
    pattern,
    (state, match, start, end) => {
      const text = match[2] as string;
      const open = start + (match[1] as string).length;
      const tr = state.tr
        .delete(open + marker.length + text.length, end)
        .delete(open, open + marker.length)
        .addMark(open, open + text.length, type.create())
        .removeStoredMark(type);
      return tr;
    },
    { inCodeMark: false },
  );
}

const linkRule = new InputRule(
  /\[([^[\]`\n]+)\]\(([^()\s]+)\)$/,
  (state, match, start, end) => {
    const href = safeHref(match[2] as string);
    if (!href) return null;
    const textEnd = start + 1 + (match[1] as string).length;
    return state.tr
      .delete(textEnd, end)
      .delete(start, start + 1)
      .addMark(start, textEnd - 1, marks.link.create({ href }));
  },
  { inCodeMark: false },
);

const rules = inputRules({
  rules: [
    markRule(/(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, marks.bold, '**'),
    markRule(/(^|[^~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, marks.strike, '~~'),
    // Like the parser: an underscore inside a word (snake_case) never starts italics.
    markRule(/(^|[^\p{L}\p{N}_])_([^_\s](?:[^_]*[^_\s])?)_$/u, marks.italic, '_'),
    markRule(/(^|[^`])`([^`]+)`$/, marks.code, '`'),
    linkRule,
    wrappingInputRule(/^\s*[-*]\s$/, nodes.bullet_list),
    wrappingInputRule(
      /^(\d{1,9})\.\s$/,
      nodes.ordered_list,
      (match) => ({ order: Number(match[1]) }),
      (match, node) => node.childCount + (node.attrs.order as number) === Number(match[1]),
    ),
    wrappingInputRule(/^\s*>\s$/, nodes.blockquote),
    textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading, (match) => ({
      level: (match[1] as string).length,
    })),
    textblockTypeInputRule(/^```$/, nodes.code_block),
  ],
});

// ---------------------------------------------------------------------------------------------
// Commands

function ancestor(state: EditorState, test: (node: Node) => boolean) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (test(node)) return { node, pos: $from.before(depth) };
  }
  return null;
}

const isList = (node: Node) => node.type === nodes.bullet_list || node.type === nodes.ordered_list;

/** In a code block: a new line, or leave the block when the last line is already empty. */
const codeNewLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!$from.parent.type.spec.code) return false;
  if (dispatch) {
    const text = $from.parent.textContent;
    if (empty && $from.parentOffset === text.length && text.endsWith('\n')) {
      const tr = state.tr.delete($from.pos - 1, $from.pos);
      const after = tr.mapping.map($from.after());
      tr.insert(after, nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
      dispatch(tr.scrollIntoView());
    } else {
      dispatch(state.tr.insertText('\n').scrollIntoView());
    }
  }
  return true;
};

const isEmptyLineIn = (state: EditorState, type: NodeType) => {
  const { $from, empty } = state.selection;
  return (
    empty && $from.parent.content.size === 0 && $from.depth > 1 && $from.node(-1).type === type
  );
};

/** An empty list item leaves the list. */
const leaveList: Command = (state, dispatch) =>
  isEmptyLineIn(state, nodes.list_item) && liftListItem(nodes.list_item)(state, dispatch);

/** An empty line at the end of a quote leaves the quote. */
const leaveQuote: Command = (state, dispatch) => {
  const { $from } = state.selection;
  if (!isEmptyLineIn(state, nodes.blockquote)) return false;
  if ($from.index(-1) !== $from.node(-1).childCount - 1) return false;
  return lift(state, dispatch);
};

/** Shift+Enter, and Enter on touch screens: the next line, item or block. */
export const newLine: Command = chainCommands(
  codeNewLine,
  leaveList,
  splitListItem(nodes.list_item),
  leaveQuote,
  splitBlock,
);

const atBlockStart = (state: EditorState) => {
  const { $from, empty } = state.selection;
  return empty && $from.parentOffset === 0;
};

/** Backspace at the start of a heading or code block makes it a plain line. */
const resetBlock: Command = (state, dispatch) => {
  const { $from } = state.selection;
  const type = $from.parent.type;
  if (!atBlockStart(state) || (type !== nodes.heading && type !== nodes.code_block)) return false;
  return setBlockType(nodes.paragraph)(state, dispatch);
};

/** Backspace at the start of a list item takes it out of the list. */
const liftItem: Command = (state, dispatch) =>
  atBlockStart(state) &&
  state.selection.$from.node(-1).type === nodes.list_item &&
  liftListItem(nodes.list_item)(state, dispatch);

/** A mention pill goes as one character (browsers differ on non-editable inline nodes). */
const deleteMention: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.nodeBefore?.type !== nodes.mention) return false;
  dispatch?.(state.tr.delete($from.pos - $from.nodeBefore.nodeSize, $from.pos));
  return true;
};

const toggleList =
  (type: NodeType): Command =>
  (state, dispatch) => {
    const list = ancestor(state, isList);
    if (!list) return wrapInList(type)(state, dispatch);
    if (list.node.type === type) return liftListItem(nodes.list_item)(state, dispatch);
    dispatch?.(
      state.tr.setNodeMarkup(list.pos, type, type === nodes.ordered_list ? { order: 1 } : null),
    );
    return true;
  };

const toggleQuote: Command = (state, dispatch) =>
  ancestor(state, (n) => n.type === nodes.blockquote)
    ? lift(state, dispatch)
    : wrapIn(nodes.blockquote)(state, dispatch);

/** Removes the link at the selection, or around the caret. */
const removeLink: Command = (state, dispatch) => {
  let { from, to } = state.selection;
  if (from === to) {
    const { $from } = state.selection;
    const parent = $from.parent;
    const start = $from.start();
    let found = false;
    parent.forEach((child, offset) => {
      const a = start + offset;
      const b = a + child.nodeSize;
      if (a <= from && from <= b && marks.link.isInSet(child.marks)) {
        if (!found) [from, to] = [a, b];
        else to = Math.max(to, b);
        found = true;
      }
    });
    if (!found) return false;
  }
  dispatch?.(state.tr.removeMark(from, to, marks.link));
  return true;
};

const MARK_OF: Partial<Record<FormatKind, MarkType>> = {
  bold: marks.bold,
  italic: marks.italic,
  strike: marks.strike,
  code: marks.code,
};

/** The toolbar's buttons. `link` here only removes a link: adding one asks for the address. */
export function toggleFormat(kind: FormatKind): Command {
  const mark = MARK_OF[kind];
  if (mark) return toggleMark(mark);
  if (kind === 'bulletList') return toggleList(nodes.bullet_list);
  if (kind === 'numberedList') return toggleList(nodes.ordered_list);
  if (kind === 'quote') return toggleQuote;
  return removeLink;
}

/** Links the selection; without one, inserts the address as a link. */
export function setLink(href: string): Command {
  return (state, dispatch) => {
    const mark = marks.link.create({ href });
    const { from, to, empty } = state.selection;
    if (dispatch) {
      const tr = empty
        ? state.tr.insert(from, schema.text(href, [mark]))
        : state.tr.addMark(from, to, mark);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Which toolbar formats apply at the selection (for `aria-pressed`). */
export function activeFormats(state: EditorState): Set<FormatKind> {
  const active = new Set<FormatKind>();
  const { from, to, empty, $from } = state.selection;
  const here = state.storedMarks ?? $from.marks();
  const hasMark = (type: MarkType) =>
    empty ? type.isInSet(here) !== undefined : state.doc.rangeHasMark(from, to, type);
  for (const [kind, type] of Object.entries(MARK_OF)) {
    if (hasMark(type)) active.add(kind as FormatKind);
  }
  if (hasMark(marks.link)) active.add('link');
  const list = ancestor(state, isList);
  if (list) active.add(list.node.type === nodes.bullet_list ? 'bulletList' : 'numberedList');
  if (ancestor(state, (n) => n.type === nodes.blockquote)) active.add('quote');
  return active;
}

// ---------------------------------------------------------------------------------------------
// Mentions

export interface MentionQuery {
  query: string;
  /** Document range of `@query`, replaced by the picked mention. */
  from: number;
  to: number;
}

/** The `@query` being typed at the caret (never in code), as in the plain composer. */
export function mentionAt(state: EditorState): MentionQuery | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.spec.code || marks.code.isInSet($from.marks())) return null;
  // Every inline atom is one position, so offsets in this text are document offsets.
  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const found = mentionQueryAt(text, text.length);
  return found ? { query: found.query, from: $from.start() + found.start, to: $from.pos } : null;
}

export function insertMention(at: MentionQuery, id: string, label: string): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.replaceWith(at.from, at.to, [
        nodes.mention.create({ id, label }),
        schema.text(' '),
      ]);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ---------------------------------------------------------------------------------------------
// Paste, placeholder and the state

const RICH_HTML_RE = /<(strong|b|em|i|s|del|strike|a|h[1-6]|ul|ol|li|blockquote|pre|code)[\s>]/i;

/**
 * Whether a paste should read the plain text as Markdown rather than the HTML: when there is no
 * HTML, or the HTML carries no formatting the chat knows (a code editor's coloured spans around
 * `**bold**`). Copies from this editor (`data-pm-slice`) and formatted pages keep their HTML.
 */
export function pastesAsMarkdown(html: string): boolean {
  if (!html) return true;
  if (html.includes('data-pm-slice')) return false;
  return !RICH_HTML_RE.test(html);
}

function markdownSlice(text: string, options: EditorOptions): Slice {
  return Slice.maxOpen(toDoc(text.replace(/\r\n?/g, '\n'), options.nameOf, options.labels).content);
}

function clipboardMarkdown(slice: Slice): string {
  let content = slice.content;
  if (content.firstChild?.isInline) content = Fragment.from(nodes.paragraph.create(null, content));
  const doc = nodes.doc.createAndFill(null, content);
  return doc ? toMarkdown(doc) : slice.content.textBetween(0, slice.content.size, '\n');
}

function pastePlugin(options: EditorOptions) {
  return new Plugin({
    props: {
      clipboardTextParser: (text) => markdownSlice(text, options),
      clipboardTextSerializer: clipboardMarkdown,
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        const text = data.getData?.('text/plain') ?? '';
        if (!text) {
          // Text copied from a spreadsheet also carries an image of the cells: the text wins.
          const images = [...(data.files ?? [])].filter((f) => f.type.startsWith('image/'));
          if (images.length === 0 || !options.onPasteFiles) return false;
          options.onPasteFiles(images);
          return true;
        }
        if (view.state.selection.$from.parent.type.spec.code) return false;
        const html = data.getData?.('text/html') ?? '';
        if (!html || !pastesAsMarkdown(html)) return false;
        const tr = view.state.tr.replaceSelection(markdownSlice(text, options));
        view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
        return true;
      },
    },
  });
}

function placeholderPlugin(options: EditorOptions) {
  return new Plugin({
    props: {
      decorations(state) {
        const first = state.doc.firstChild;
        if (state.doc.childCount !== 1 || first?.type !== nodes.paragraph || first.content.size) {
          return null;
        }
        return DecorationSet.create(state.doc, [
          Decoration.node(0, first.nodeSize, {
            class: 'is-empty',
            'data-placeholder': options.placeholder,
          }),
        ]);
      },
    },
  });
}

export function createState(markdown: string, options: EditorOptions): EditorState {
  const enter: Command = (state, dispatch) => options.onEnter() || newLine(state, dispatch);
  const doc = toDoc(markdown, options.nameOf, options.labels);
  return EditorState.create({
    doc,
    // An edited message continues at its end.
    selection: TextSelection.atEnd(doc),
    plugins: [
      rules,
      keymap({
        Enter: enter,
        'Shift-Enter': newLine,
        'Mod-b': toggleMark(marks.bold),
        'Mod-i': toggleMark(marks.italic),
        'Mod-Shift-x': toggleMark(marks.strike),
        'Mod-z': undo,
        'Shift-Mod-z': redo,
        'Mod-y': redo,
        Backspace: chainCommands(undoInputRule, deleteMention, resetBlock, liftItem),
      }),
      keymap(baseKeymap),
      history(),
      pastePlugin(options),
      placeholderPlugin(options),
    ],
  });
}

/** Replaces the whole draft as one undoable step, with the caret at the end. */
export function replaceDraft(
  state: EditorState,
  markdown: string,
  options: EditorOptions,
): Transaction {
  const doc = toDoc(markdown, options.nameOf, options.labels);
  // Its own undo step, even right after typing.
  const tr = closeHistory(state.tr).replaceWith(0, state.doc.content.size, doc.content);
  return tr.setSelection(TextSelection.atEnd(tr.doc)).scrollIntoView();
}
