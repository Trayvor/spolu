import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps text colour next to a custom font size', () => {
    expect(cn('text-primary-foreground', 'text-tiny')).toBe('text-primary-foreground text-tiny');
    expect(cn('text-button', 'text-primary-foreground')).toBe(
      'text-button text-primary-foreground',
    );
  });
  it('still lets a later font size replace an earlier one', () => {
    expect(cn('text-button', 'text-tiny')).toBe('text-tiny');
  });
});
