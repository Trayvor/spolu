import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  BulkPalette,
  BulkTextColors,
  isBulkLinkUrl,
  type BulkAlign,
  type BulkTextNode,
} from '@spolu/shared';
import { Icon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { withNamespaces } from '@/i18n/namespaces';
import { cn } from '@/lib/utils';
import { FieldNote } from './parts';
import { applyBoldShortcuts, domToNodes, nodesToEditorHtml } from './rich-text';

/**
 * The text block's editor (Phase 31, spec §4): a `contenteditable` box with a toolbar. The
 * commands are the browser's editing commands; after every input the DOM is read back into the
 * document tree (`domToNodes`), which keeps only what an email may hold. A paste is inserted
 * through the same filter, so pasted styles and images never even show. Uncontrolled: `value`
 * is read when the editor mounts (the block list remounts it when the version changes).
 */

type Toggle = 'bold' | 'italic' | 'underline' | 'strikeThrough';
const TOGGLES: Toggle[] = ['bold', 'italic', 'underline', 'strikeThrough'];

// The microphone and the AI button (and the `chat` texts they show) load on their own.
const AiTools = lazy(withNamespaces(['chat'], () => import('./rich-text-ai-tools')));

const exec = (command: string, value?: string) => {
  if (typeof document.execCommand !== 'function') return;
  document.execCommand(command, false, value);
};

function ToolButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      // Keep the text selection: the command applies to it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-button transition-colors duration-(--duration-fast) hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-foreground touch:size-11',
        pressed && 'bg-card shadow-lift',
      )}
    >
      {children}
    </button>
  );
}

const Rule = () => <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />;

const ICONS = {
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  unlink: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16" />
  ),
  bullet: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  ordered: <path d="M10 6h10M10 12h10M10 18h10M4 5l1-1v4M4 14h2l-2 3h2" />,
  left: <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  center: <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  right: <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
} as const;

export function RichTextEditor({
  id,
  value,
  align,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  value: BulkTextNode[];
  align: BulkAlign;
  invalid?: boolean;
  describedBy?: string;
  onChange: (nodes: BulkTextNode[]) => void;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState<Record<Toggle, boolean>>({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
  });
  const [link, setLink] = useState<{ range: Range | null; url: string; bad: boolean } | null>(null);
  // Written once on mount; later the DOM is the source and `onChange` reports the tree.
  const initial = useRef({ value, align });
  useLayoutEffect(() => {
    if (box.current)
      box.current.innerHTML = nodesToEditorHtml(initial.current.value, initial.current.align);
  }, []);

  const read = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const nodes = domToNodes(el);
    const shortcut = applyBoldShortcuts(nodes);
    if (shortcut !== nodes) {
      // `**word**` was typed: show it bold and put the caret at the end.
      el.innerHTML = nodesToEditorHtml(shortcut, align);
      const selection = window.getSelection();
      if (selection) {
        selection.selectAllChildren(el);
        selection.collapseToEnd();
      }
    }
    onChange(shortcut);
  }, [align, onChange]);

  // The B / I / U / S buttons show the state of the selection.
  useEffect(() => {
    const update = () => {
      const el = box.current;
      const node = window.getSelection()?.anchorNode;
      if (!el || !node || !el.contains(node) || typeof document.queryCommandState !== 'function') {
        return;
      }
      setPressed({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
      });
    };
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);

  // A select takes the focus: the selection it applies to is kept and put back.
  const saved = useRef<Range | null>(null);
  const keepSelection = () => {
    const selection = window.getSelection();
    saved.current =
      selection && selection.rangeCount > 0 && box.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
  };
  const run = (command: string, arg?: string) => {
    box.current?.focus();
    const selection = window.getSelection();
    if (saved.current && selection) {
      selection.removeAllRanges();
      selection.addRange(saved.current);
      saved.current = null;
    }
    exec(command, arg);
    read();
  };

  const openLink = () => {
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 && box.current?.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
    setLink({ range, url: 'https://', bad: false });
  };
  const applyLink = () => {
    if (!link) return;
    const url = link.url.trim();
    if (!isBulkLinkUrl(url)) {
      setLink({ ...link, bad: true });
      return;
    }
    box.current?.focus();
    const selection = window.getSelection();
    if (link.range && selection) {
      selection.removeAllRanges();
      selection.addRange(link.range);
    }
    if (!selection || selection.isCollapsed) {
      // Nothing selected: the address is the link's text.
      const safe = url.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      exec('insertHTML', `<a href="${safe}">${safe}</a>`);
    } else {
      exec('createLink', url);
    }
    setLink(null);
    read();
  };

  // The AI and voice tools replace the whole text: write the tree into the editor and report it.
  const setNodes = (nodes: BulkTextNode[]) => {
    if (box.current) box.current.innerHTML = nodesToEditorHtml(nodes, align);
    read();
  };

  const linkId = `${id}-link`;
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-md border-2 border-input bg-card transition-colors duration-(--duration-fast) focus-within:border-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
        invalid && 'border-destructive',
      )}
    >
      <div
        role="toolbar"
        aria-label={t('bulkEmail.rich.toolbar')}
        aria-controls={id}
        className="flex flex-wrap items-center gap-0.5 border-b-2 border-input bg-secondary px-1.5 py-1"
      >
        <select
          aria-label={t('bulkEmail.rich.style')}
          className="h-8 rounded-md bg-transparent px-2 text-tiny font-semibold hover:bg-surface-3 touch:h-11"
          value=""
          onFocus={keepSelection}
          onChange={(e) => {
            if (e.target.value) run('formatBlock', e.target.value);
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            {t('bulkEmail.rich.style')}
          </option>
          <option value="p">{t('bulkEmail.rich.paragraph')}</option>
          <option value="h2">{t('bulkEmail.rich.h2')}</option>
          <option value="h3">{t('bulkEmail.rich.h3')}</option>
        </select>
        <Rule />
        {TOGGLES.map((command) => (
          <ToolButton
            key={command}
            label={t(`bulkEmail.rich.${command}`)}
            pressed={pressed[command]}
            onClick={() => run(command)}
          >
            <span
              aria-hidden="true"
              className={cn(
                'text-button',
                command === 'bold' && 'font-bold',
                command === 'italic' && 'font-serif italic',
                command === 'underline' && 'underline',
                command === 'strikeThrough' && 'line-through',
              )}
            >
              {t(`bulkEmail.rich.${command}Glyph`)}
            </span>
          </ToolButton>
        ))}
        <Rule />
        <ToolButton label={t('bulkEmail.rich.link')} onClick={openLink}>
          <Icon>{ICONS.link}</Icon>
        </ToolButton>
        <ToolButton label={t('bulkEmail.rich.unlink')} onClick={() => run('unlink')}>
          <Icon>{ICONS.unlink}</Icon>
        </ToolButton>
        <Rule />
        <ToolButton label={t('bulkEmail.rich.bullet')} onClick={() => run('insertUnorderedList')}>
          <Icon>{ICONS.bullet}</Icon>
        </ToolButton>
        <ToolButton label={t('bulkEmail.rich.ordered')} onClick={() => run('insertOrderedList')}>
          <Icon>{ICONS.ordered}</Icon>
        </ToolButton>
        <Rule />
        <ToolButton label={t('bulkEmail.rich.alignLeft')} onClick={() => run('justifyLeft')}>
          <Icon>{ICONS.left}</Icon>
        </ToolButton>
        <ToolButton label={t('bulkEmail.rich.alignCenter')} onClick={() => run('justifyCenter')}>
          <Icon>{ICONS.center}</Icon>
        </ToolButton>
        <ToolButton label={t('bulkEmail.rich.alignRight')} onClick={() => run('justifyRight')}>
          <Icon>{ICONS.right}</Icon>
        </ToolButton>
        <Rule />
        <select
          aria-label={t('bulkEmail.rich.color')}
          className="h-8 rounded-md bg-transparent px-2 text-tiny font-semibold hover:bg-surface-3 touch:h-11"
          value=""
          onFocus={keepSelection}
          onChange={(e) => {
            const key = e.target.value as (typeof BulkTextColors)[number];
            if (key) run('foreColor', BulkPalette[key]);
            e.target.value = '';
          }}
        >
          <option value="" disabled>
            {t('bulkEmail.rich.color')}
          </option>
          {BulkTextColors.map((key) => (
            <option key={key} value={key}>
              {t(`bulkEmail.colors.${key}`)}
            </option>
          ))}
        </select>
        <Suspense fallback={null}>
          <span className="ml-auto flex items-center gap-1">
            <AiTools
              getNodes={() => (box.current ? domToNodes(box.current) : [])}
              setNodes={setNodes}
            />
          </span>
        </Suspense>
      </div>
      {link && (
        <div className="flex flex-col gap-2 border-b-2 border-input px-3 py-3">
          <label htmlFor={linkId} className="text-tiny font-semibold">
            {t('bulkEmail.rich.linkAddress')}
          </label>
          <div className="flex flex-col gap-2 @min-[480px]:flex-row">
            <Input
              id={linkId}
              inputMode="url"
              autoFocus
              value={link.url}
              aria-invalid={link.bad ? true : undefined}
              onChange={(e) => setLink({ ...link, url: e.target.value, bad: false })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
                if (e.key === 'Escape') setLink(null);
              }}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={applyLink}>
                {t('bulkEmail.rich.linkApply')}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLink(null)}>
                {t('bulkEmail.editor.cancel')}
              </Button>
            </div>
          </div>
          {link.bad && <FieldNote error>{t('bulkEmail.rich.linkInvalid')}</FieldNote>}
        </div>
      )}
      <div
        ref={box}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label={t('bulkEmail.fields.text')}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        contentEditable
        suppressContentEditableWarning
        onInput={read}
        onBlur={read}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          if (html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            exec('insertHTML', nodesToEditorHtml(domToNodes(doc.body), 'left'));
          } else {
            exec('insertText', e.clipboardData.getData('text/plain'));
          }
          read();
        }}
        className="min-h-[132px] px-[18px] py-[13px] text-button font-medium text-foreground outline-none [&_a]:underline [&_h2]:text-medium [&_h2]:font-semibold [&_h3]:text-body [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-0 [&_ul]:list-disc [&_ul]:pl-6 [&>*+*]:mt-3"
      />
    </div>
  );
}
