import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { FormatKind } from '../composer-text';
import type { MentionLabels } from './markdown';
import { toMarkdown } from './markdown';
import {
  activeFormats,
  createState,
  insertMention,
  mentionAt,
  replaceDraft,
  setLink,
  toggleFormat,
  type EditorOptions,
  type MentionQuery,
} from './setup';

/** What the composer can do with its draft. */
export interface ChatEditorHandle {
  /** The draft as stored Markdown (mention tokens `<@id>`). */
  getMarkdown(): string;
  /** Replaces the draft; one undo step, so Cmd/Ctrl+Z brings the old text back. */
  setMarkdown(markdown: string): void;
  focus(): void;
  /** Empties the draft and its undo history (after Send). */
  clear(): void;
  format(kind: FormatKind): void;
  setLink(href: string): void;
  insertMention(at: MentionQuery, id: string, label: string): void;
  /** Types `text` at the cursor (over the selection), as if typed: the emoji button. */
  insertText(text: string): void;
}

export interface EditorChange {
  markdown: string;
  docChanged: boolean;
  mention: MentionQuery | null;
  active: Set<FormatKind>;
}

export interface ChatEditorProps {
  ref?: Ref<ChatEditorHandle>;
  initialMarkdown: string;
  nameOf(id: string): string | undefined;
  labels: MentionLabels;
  placeholder: string;
  ariaLabel: string;
  /** The mention list while it is open (`aria-controls` / `aria-activedescendant`). */
  ariaControls?: string;
  ariaActiveDescendant?: string;
  autoFocus?: boolean;
  /**
   * Document mode (Phase 33 part P5, a description field): at least 6 lines, grows to 16, then
   * scrolls. The caller's `onEnter` answers false, so Enter always makes a new line.
   */
  document?: boolean;
  onEnter(): boolean;
  /** Runs before the editor's own keys; true when the composer used the key (the mention list). */
  onKeyDown?(event: KeyboardEvent): boolean;
  onPasteFiles?(files: File[]): void;
  onChange(change: EditorChange): void;
}

// The draft grows to eight lines (24 px each plus padding), then scrolls. The content classes
// follow `format/render.tsx`; the placeholder is the empty first line's ::before.
const editorClass = [
  'block max-h-52 min-h-10 w-full overflow-y-auto whitespace-pre-wrap px-3 py-2 text-body outline-none [overflow-wrap:anywhere]',
  '[&>blockquote]:my-1 [&>h3]:my-1 [&>h4]:my-1 [&>h5]:my-1 [&>ol]:my-1 [&>pre]:my-1 [&>ul]:my-1',
  '[&_blockquote]:gap-0',
  '[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground [&_.is-empty]:before:content-[attr(data-placeholder)]',
].join(' ');
const documentClass = editorClass.replace('max-h-52 min-h-10', 'max-h-[25rem] min-h-40');

function attributesOf(
  p: Pick<ChatEditorProps, 'ariaLabel' | 'ariaControls' | 'ariaActiveDescendant' | 'document'>,
): Record<string, string> {
  const attrs: Record<string, string> = {
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': p.ariaLabel,
    'aria-autocomplete': 'list',
    class: p.document ? documentClass : editorClass,
  };
  if (p.ariaControls) attrs['aria-controls'] = p.ariaControls;
  if (p.ariaActiveDescendant) attrs['aria-activedescendant'] = p.ariaActiveDescendant;
  return attrs;
}

/**
 * The composer's WYSIWYG Markdown field (ProseMirror). Lazy: the composer loads this chunk on
 * its own, so ProseMirror never weighs on the first screen.
 */
export default function ChatEditor({ ref, ...props }: ChatEditorProps) {
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const markdown = useRef(props.initialMarkdown);
  const { ariaLabel, ariaControls, ariaActiveDescendant, document: documentMode } = props;

  // One options object for the editor's life; it reads the latest props on every use.
  const [options] = useState<EditorOptions>(() => ({
    nameOf: (id) => latest.current.nameOf(id),
    get labels() {
      return latest.current.labels;
    },
    get placeholder() {
      return latest.current.placeholder;
    },
    onEnter: () => latest.current.onEnter(),
    onPasteFiles: (files) => latest.current.onPasteFiles?.(files),
  }));

  useLayoutEffect(() => {
    const editor = new EditorView(mount.current, {
      state: createState(markdown.current, options),
      attributes: () => attributesOf(latest.current),
      handleKeyDown: (_view, event) => latest.current.onKeyDown?.(event) ?? false,
      dispatchTransaction(tr) {
        const next = editor.state.apply(tr);
        editor.updateState(next);
        if (!tr.docChanged && !tr.selectionSet && !tr.storedMarksSet) return;
        if (tr.docChanged) markdown.current = toMarkdown(next.doc);
        latest.current.onChange({
          markdown: markdown.current,
          docChanged: tr.docChanged,
          mention: mentionAt(next),
          active: activeFormats(next),
        });
      },
    });
    view.current = editor;
    if (latest.current.autoFocus) editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Created once; later props are read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const attributes = attributesOf({
      ariaLabel,
      ariaControls,
      ariaActiveDescendant,
      document: documentMode,
    });
    view.current?.setProps({ attributes });
  }, [ariaLabel, ariaControls, ariaActiveDescendant, documentMode]);

  useImperativeHandle(ref, () => {
    const run = (command: Command) => {
      const v = view.current;
      if (!v) return;
      command(v.state, v.dispatch);
      v.focus();
    };
    return {
      getMarkdown: () => markdown.current,
      setMarkdown(md) {
        const v = view.current;
        if (!v) return;
        v.dispatch(replaceDraft(v.state, md, options));
        v.focus();
      },
      focus: () => view.current?.focus(),
      clear() {
        const v = view.current;
        if (!v) return;
        markdown.current = '';
        v.updateState(createState('', options));
        latest.current.onChange({
          markdown: '',
          docChanged: true,
          mention: null,
          active: new Set(),
        });
      },
      format: (kind) => run(toggleFormat(kind)),
      setLink: (href) => run(setLink(href)),
      insertMention: (at, id, label) => run(insertMention(at, id, label)),
      insertText: (text) =>
        run((state, dispatch) => {
          dispatch?.(state.tr.insertText(text).scrollIntoView());
          return true;
        }),
    };
  }, [options]);

  return <div ref={mount} />;
}
