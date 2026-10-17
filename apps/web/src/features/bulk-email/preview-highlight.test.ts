import { describe, expect, it } from 'vitest';
import { blockIdAt, markBuilder, markPreview, stripMarkers } from './preview-highlight';

function builder(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <ol>
      <li data-block-id="a">A</li>
      <li data-block-id="c">
        <ol><li data-block-id="in&quot;"><button>inner</button></li></ol>
      </li>
    </ol>`;
  return root;
}

function preview(): Document {
  const doc = document.implementation.createHTMLDocument('email');
  doc.body.innerHTML = `
    <table><tr><td data-sp-block="a">A <a href="https://x">link</a></td></tr>
    <tr><td data-sp-block="c"><table><tr><td data-sp-block='in"'>inner</td></tr></table></td></tr></table>
    <div class="sp-phone"><table><tr><td data-sp-block="a">A on the phone</td></tr></table></div>`;
  return doc;
}

describe('markBuilder', () => {
  it('marks the active and the hovered block card, and clears the others', () => {
    const root = builder();
    markBuilder(root, { hover: 'in"', active: 'a' });
    expect(root.querySelector('[data-block-id="a"]')!.getAttribute('data-hl')).toBe('active');
    expect(root.querySelector('[data-block-id="in\\""]')!.getAttribute('data-hl')).toBe('hover');
    markBuilder(root, { hover: null, active: 'c' });
    expect(root.querySelector('[data-block-id="a"]')!.hasAttribute('data-hl')).toBe(false);
    expect(root.querySelector('[data-block-id="in\\""]')!.hasAttribute('data-hl')).toBe(false);
    expect(root.querySelector('[data-block-id="c"]')!.getAttribute('data-hl')).toBe('active');
  });

  it('active wins when the same block is also hovered', () => {
    const root = builder();
    markBuilder(root, { hover: 'a', active: 'a' });
    expect(root.querySelector('[data-block-id="a"]')!.getAttribute('data-hl')).toBe('active');
  });
});

describe('markPreview', () => {
  it('outlines every copy of the block (computer and phone), solid when active, dashed on hover', () => {
    const doc = preview();
    markPreview(doc, { hover: 'c', active: 'a' });
    const copies = [...doc.querySelectorAll<HTMLElement>('[data-sp-block="a"]')];
    expect(copies).toHaveLength(2);
    for (const el of copies) expect(el.style.outline).toMatch(/solid/);
    expect(doc.querySelector<HTMLElement>('[data-sp-block="c"]')!.style.outline).toMatch(/dashed/);
    markPreview(doc, { hover: null, active: null });
    expect(doc.querySelector<HTMLElement>('[data-sp-block="a"]')!.style.outline).toBe('');
    expect(doc.querySelector<HTMLElement>('[data-sp-block="c"]')!.style.outline).toBe('');
  });

  it('finds ids that need escaping', () => {
    const doc = preview();
    markPreview(doc, { hover: null, active: 'in"' });
    expect(doc.querySelector<HTMLElement>("td[data-sp-block='in\"']")!.style.outline).toMatch(
      /solid/,
    );
  });
});

describe('blockIdAt', () => {
  it('is the innermost block around the clicked element', () => {
    const doc = preview();
    expect(blockIdAt(doc.querySelector('a'))).toBe('a');
    expect(blockIdAt(doc.querySelector("td[data-sp-block='in\"']"))).toBe('in"');
    expect(blockIdAt(doc.body)).toBeNull();
    expect(blockIdAt(null)).toBeNull();
  });
});

describe('stripMarkers', () => {
  it('measures the email as it is sent: without the preview markers', () => {
    expect(
      stripMarkers('<td data-sp-block="a" align="left">x</td><td data-sp-block="b&quot;">'),
    ).toBe('<td align="left">x</td><td>');
  });
});
