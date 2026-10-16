import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AssignedPill } from './assigned-pill';

describe('AssignedPill', () => {
  it('renders nothing at 0', () => {
    const { container } = render(<AssignedPill count={0} label="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows 99+ above 99', () => {
    render(<AssignedPill count={120} label="120 tasks assigned to you" />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('has the attention classes and the label', () => {
    render(<AssignedPill count={4} label="4 tasks assigned to you" />);
    const visible = screen.getByText('4');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(visible.parentElement).toHaveClass('bg-attention', 'text-attention-foreground');
    expect(screen.getByText('4 tasks assigned to you')).toHaveClass('sr-only');
  });
});
