/**
 * The link between the builder and its live preview (spec 2026-10-17-bulk-email-builder-layout):
 * the block the admin hovers or edits is outlined in the preview and its card is marked in the
 * builder; a click in the preview selects the block. Plain DOM work, outside React, so moving
 * the pointer over 50 blocks never re-renders the editor.
 *
 * The preview HTML carries `data-sp-block="<id>"` on each block's cell (the preview route's
 * `markBlocks`, never in a sent email); builder cards carry `data-block-id`.
 */

export type Highlight = { hover: string | null; active: string | null };

/**
 * The brand purple (`--brand-purple` in theme.css): the one colour that ties a card to its
 * block. Read from the app's root, since the preview iframe does not load the app's CSS; the
 * fallback is the same value, for a document without the theme (tests).
 */
const outlineColor = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--brand-purple').trim() || '#7654FF';

const stateOf = (id: string | null, h: Highlight): 'active' | 'hover' | null =>
  id === null ? null : id === h.active ? 'active' : id === h.hover ? 'hover' : null;

/** Marks the builder cards: `data-hl="active"` (edited) or `"hover"`; the rest unmarked. */
export function markBuilder(root: ParentNode, h: Highlight): void {
  for (const el of root.querySelectorAll('[data-block-id]')) {
    const state = stateOf(el.getAttribute('data-block-id'), h);
    if (state) el.setAttribute('data-hl', state);
    else el.removeAttribute('data-hl');
  }
}

/**
 * Outlines the block in the preview, every copy of it (a separate phone version repeats ids):
 * solid while it is edited, dashed while hovered. Inline styles: nothing is added to the email's
 * own stylesheet, so its media rules stay exactly as sent.
 */
export function markPreview(doc: Document, h: Highlight): void {
  const color = outlineColor();
  for (const el of doc.querySelectorAll<HTMLElement>('[data-sp-block]')) {
    const state = stateOf(el.getAttribute('data-sp-block'), h);
    if (state) {
      el.style.outline = `2px ${state === 'active' ? 'solid' : 'dashed'} ${color}`;
      el.style.outlineOffset = '4px';
      el.style.borderRadius = '4px';
    } else if (el.style.outline) {
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.borderRadius = '';
    }
  }
}

/** Scrolls the preview (its own window, never the page) so the shown copy of `id` is in view. */
function revealInPreview(doc: Document, id: string): void {
  const win = doc.defaultView;
  if (!win) return;
  const el = [...doc.querySelectorAll<HTMLElement>('[data-sp-block]')].find(
    (e) => e.getAttribute('data-sp-block') === id && e.getClientRects().length > 0,
  );
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const margin = 24;
  if (rect.top >= margin && rect.bottom <= win.innerHeight - margin) return;
  // A block taller than the window starts at the top; a short one comes into view at a third.
  const top =
    rect.height > win.innerHeight - 2 * margin
      ? rect.top - margin
      : rect.top - (win.innerHeight - rect.height) / 3;
  win.scrollTo({ top: win.scrollY + top });
}

/** The id of the innermost block around `target` (a click or hover in the preview). */
export function blockIdAt(target: EventTarget | null): string | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return null;
  return el.closest('[data-sp-block]')?.getAttribute('data-sp-block') ?? null;
}

/** Holds the hovered and the edited block and keeps the builder and the preview marked. */
export type Highlighter = {
  hover: (id: string | null) => void;
  /** The block being edited; `reveal` scrolls the preview to it. */
  activate: (id: string | null, reveal?: boolean) => void;
  attachBuilder: (root: ParentNode | null) => void;
  attachPreview: (doc: Document | null) => void;
  /** After the builder re-rendered (new cards come unmarked). */
  refreshBuilder: () => void;
  /** After the preview got a new document. */
  refreshPreview: () => void;
};

export function createHighlighter(): Highlighter {
  const h: Highlight = { hover: null, active: null };
  let builder: ParentNode | null = null;
  let preview: Document | null = null;
  const refreshBuilder = () => {
    if (builder) markBuilder(builder, h);
  };
  const refreshPreview = () => {
    if (preview) markPreview(preview, h);
  };
  return {
    hover(id) {
      if (h.hover === id) return;
      h.hover = id;
      refreshBuilder();
      refreshPreview();
    },
    activate(id, reveal = true) {
      if (h.active !== id) {
        h.active = id;
        refreshBuilder();
        refreshPreview();
      }
      if (reveal && id && preview) revealInPreview(preview, id);
    },
    attachBuilder(root) {
      builder = root;
      refreshBuilder();
    },
    attachPreview(doc) {
      preview = doc;
      refreshPreview();
    },
    refreshBuilder,
    refreshPreview,
  };
}

/** The preview HTML as it is sent: without the markers (for the Gmail size warning). */
export const stripMarkers = (html: string): string => html.replace(/ data-sp-block="[^"]*"/g, '');
