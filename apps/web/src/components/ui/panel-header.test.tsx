import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PanelHeader } from './panel-header';

describe('PanelHeader', () => {
  it('names the back button "Back to the board" by default', () => {
    render(<PanelHeader onClose={() => undefined}>x</PanelHeader>);
    expect(screen.getByRole('button', { name: 'Back to the board' })).toBeInTheDocument();
  });

  it('takes another back label', () => {
    render(
      <PanelHeader onClose={() => undefined} backLabel="Back to the knowledge base">
        x
      </PanelHeader>,
    );
    expect(screen.getByRole('button', { name: 'Back to the knowledge base' })).toBeInTheDocument();
  });
});
