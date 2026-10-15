import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar, avatarColor } from './avatar';

const CLASSES = [
  'bg-brand-purple',
  'bg-brand-pink',
  'bg-brand-blue',
  'bg-brand-coral',
  'bg-success',
];

describe('avatarColor', () => {
  it('the same id always gets the same color', () => {
    expect(avatarColor('user-1')).toBe(avatarColor('user-1'));
  });

  it('the color is one of the five classes', () => {
    for (let i = 0; i < 20; i++) expect(CLASSES).toContain(avatarColor(`id-${i}`));
  });

  it('ids spread over more than one color', () => {
    const colors = new Set(Array.from({ length: 20 }, (_, i) => avatarColor(`id-${i}`)));
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });
});

describe('Avatar', () => {
  it("initials 'Jana Nováková' → 'JN', 'eva' → 'E', '' → '?'", () => {
    const { container, rerender } = render(<Avatar userId="a" name="Jana Nováková" />);
    expect(container.textContent).toBe('JN');
    rerender(<Avatar userId="a" name="eva" />);
    expect(container.textContent).toBe('E');
    rerender(<Avatar userId="a" name="" />);
    expect(container.textContent).toBe('?');
  });

  it('uses the first and the last word', () => {
    const { container } = render(<Avatar userId="a" name="Jana Maria Nováková" />);
    expect(container.textContent).toBe('JN');
  });

  it('size sets width and height and is hidden from assistive tech', () => {
    const { container } = render(<Avatar userId="a" name="Jana" size={40} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('40px');
    expect(el.style.height).toBe('40px');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
