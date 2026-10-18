import type { Locator } from '@playwright/test';

/**
 * Replaces the text of a rich-text (ProseMirror) editor through the editor's own keys. `fill`
 * selects the old text in the DOM, and ProseMirror reads that selection only on the next
 * `selectionchange`: a re-render in between (a mention list moving its highlight, a live update,
 * a transcript just landing) writes the editor's caret back, so the Delete or the new text lands
 * after the old text instead of replacing it. Ctrl/Cmd+A is the editor's own command and moves
 * its state at once. Callers assert the result (`toHaveText`) before they go on.
 */
export async function setEditorText(box: Locator, text: string) {
  await box.press('ControlOrMeta+a');
  await box.press('Backspace');
  if (text) await box.page().keyboard.insertText(text);
}
