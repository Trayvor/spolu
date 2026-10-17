import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { BuilderWorkspace, useWorkspaceLink, type WorkspaceTab } from './builder-workspace';
import type { Highlighter } from './preview-highlight';

const t = (key: string) => i18n.t(key);

function FakePreview({ onHighlighter }: { onHighlighter?: (h: Highlighter) => void }) {
  const { highlighter, select } = useWorkspaceLink();
  onHighlighter?.(highlighter);
  return (
    <button type="button" onClick={() => select('b')}>
      pick b
    </button>
  );
}

function Harness({ onHighlighter }: { onHighlighter?: (h: Highlighter) => void }) {
  const [tab, setTab] = useState<WorkspaceTab>('blocks');
  return (
    <BuilderWorkspace
      tab={tab}
      onTab={setTab}
      blocks={
        <ol>
          <li data-block-id="a" data-testid="card-a" tabIndex={-1}>
            <input aria-label="A field" />
          </li>
          <li data-block-id="b" data-testid="card-b" tabIndex={-1}>
            B
          </li>
        </ol>
      }
      preview={<FakePreview onHighlighter={onHighlighter} />}
    />
  );
}

describe('BuilderWorkspace', () => {
  it('marks the hovered card and the one being edited', () => {
    render(<Harness />);
    fireEvent.pointerOver(screen.getByTestId('card-b'));
    expect(screen.getByTestId('card-b')).toHaveAttribute('data-hl', 'hover');
    fireEvent.focus(screen.getByLabelText('A field'));
    expect(screen.getByTestId('card-a')).toHaveAttribute('data-hl', 'active');
    fireEvent.pointerLeave(screen.getByTestId('card-b').closest('[role="tabpanel"]')!);
    expect(screen.getByTestId('card-b')).not.toHaveAttribute('data-hl');
    expect(screen.getByTestId('card-a')).toHaveAttribute('data-hl', 'active');
  });

  it('a block picked in the preview shows the Blocks tab and focuses its card', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Harness />);
    fireEvent.click(screen.getByRole('tab', { name: t('bulkEmail.workspace.preview') }));
    expect(screen.getByRole('tab', { name: t('bulkEmail.workspace.preview') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'pick b' }));
    expect(screen.getByRole('tab', { name: t('bulkEmail.workspace.blocks') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('card-b')).toHaveFocus();
    expect(screen.getByTestId('card-b')).toHaveAttribute('data-hl', 'active');
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  });

  it('outlines the block in the preview document the highlighter is given', () => {
    let highlighter: Highlighter | undefined;
    render(<Harness onHighlighter={(h) => (highlighter = h)} />);
    const doc = document.implementation.createHTMLDocument('email');
    doc.body.innerHTML = '<table><tr><td data-sp-block="a">A</td></tr></table>';
    highlighter!.attachPreview(doc);
    fireEvent.pointerOver(screen.getByTestId('card-a'));
    expect(doc.querySelector<HTMLElement>('td')!.style.outline).toMatch(/dashed/);
  });
});
