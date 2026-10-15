import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setLanguage } from '@/i18n';
import { MessageBody } from './render';

const names: Record<string, string> = { u1: 'Anna Nováková' };
const nameOf = (id: string) => names[id];

describe('MessageBody', () => {
  beforeAll(async () => {
    await setLanguage('en');
  });

  it('renders no HTML from the body', () => {
    const body = '<b>hi</b> <img src=x onerror="alert(1)"> <script>alert(2)</script>';
    const { container } = render(<MessageBody body={body} nameOf={nameOf} />);
    expect(container.querySelector('b, img, script')).toBeNull();
    expect(container.textContent).toBe(body);
  });

  it('renders marks, code, quotes and lists as elements', () => {
    const body = '**b** _i_ ~~s~~ `c`\n\n```\n<b>x</b>\n```\n\n> q\n\n3. three\n- dash';
    const { container } = render(<MessageBody body={body} nameOf={nameOf} />);
    expect(container.querySelector('strong')).toHaveTextContent('b');
    expect(container.querySelector('em')).toHaveTextContent('i');
    expect(container.querySelector('s')).toHaveTextContent('s');
    expect(container.querySelector('p code')).toHaveTextContent('c');
    expect(container.querySelector('pre')).toHaveTextContent('<b>x</b>');
    expect(container.querySelector('blockquote')).toHaveTextContent('q');
    expect(container.querySelector('ol')).toHaveAttribute('start', '3');
    expect(container.querySelector('ul li')).toHaveTextContent('dash');
  });

  it('links open in a new tab with rel noreferrer noopener', () => {
    render(
      <MessageBody
        body="see https://example.com/a. and [docs](https://example.com/docs) [x](javascript:alert(1))"
        nameOf={nameOf}
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/a',
      'https://example.com/docs',
    ]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noreferrer noopener');
    }
    expect(screen.getByText(/\[x\]\(javascript:alert\(1\)\)/)).toBeInTheDocument();
  });

  it('mentions show names', () => {
    const { container } = render(
      <MessageBody body="hi <@u1>, <@gone> and <@all>" nameOf={nameOf} />,
    );
    expect(container.textContent).toBe('hi @Anna Nováková, @unknown and @all');
    expect(screen.getByText('@Anna Nováková')).toHaveClass('bg-secondary');
    expect(screen.getByText('@all')).toHaveClass('bg-secondary');
  });
});
