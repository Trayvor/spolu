import { Schema, type DOMOutputSpec, type Node } from 'prosemirror-model';
import { safeHref } from '../format/parse';
import {
  bulletListClass,
  codeBlockClass,
  codeClass,
  headingClass,
  linkClass,
  orderedListClass,
  pillClass,
  quoteClass,
} from '../format/styles';

const level = (node: Node) => node.attrs.level as 1 | 2 | 3;

/**
 * The chat's Markdown subset as a ProseMirror schema, nothing more: whatever the editor can hold,
 * `toMarkdown` can write and `format/parse.ts` reads back. A list item is one paragraph (the
 * parser has no nested lists); a mention is an atom that stores the user id (`all` for @all).
 * Mark order matters: `toMarkdown` opens marks in this order, so a link wraps the others and code
 * is innermost.
 */
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }, { tag: 'div', priority: 0 }],
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
      defining: true,
      parseDOM: [
        { tag: 'h1', attrs: { level: 1 } },
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
        { tag: 'h4', attrs: { level: 3 } },
        { tag: 'h5', attrs: { level: 3 } },
        { tag: 'h6', attrs: { level: 3 } },
      ],
      toDOM: (node): DOMOutputSpec => [
        `h${level(node) + 2}`,
        { class: headingClass[level(node)] },
        0,
      ],
    },
    blockquote: {
      group: 'block',
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', { class: quoteClass }, 0],
    },
    code_block: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: () => ['pre', { class: codeBlockClass }, ['code', 0]],
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', { class: bulletListClass }, 0],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { order: { default: 1 } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (dom: HTMLElement) => ({
            order: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) || 1 : 1,
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec =>
        node.attrs.order === 1
          ? ['ol', { class: orderedListClass }, 0]
          : ['ol', { class: orderedListClass, start: node.attrs.order as number }, 0],
    },
    list_item: {
      content: 'paragraph',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    text: { group: 'inline' },
    mention: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: false,
      marks: 'link bold italic strike',
      attrs: { id: {}, label: {} },
      parseDOM: [
        {
          tag: 'span[data-mention]',
          getAttrs: (dom: HTMLElement) => ({
            id: dom.getAttribute('data-mention'),
            label: dom.textContent ?? '',
          }),
        },
      ],
      toDOM: (node): DOMOutputSpec => [
        'span',
        { 'data-mention': node.attrs.id as string, class: pillClass, contenteditable: 'false' },
        node.attrs.label as string,
      ],
    },
    hard_break: {
      group: 'inline',
      inline: true,
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom: HTMLElement) => {
            const href = safeHref(dom.getAttribute('href') ?? '');
            return href ? { href } : false;
          },
        },
      ],
      toDOM: (mark): DOMOutputSpec => [
        'a',
        {
          href: mark.attrs.href as string,
          title: mark.attrs.href as string,
          class: linkClass,
        },
        0,
      ],
    },
    bold: {
      parseDOM: [
        { tag: 'strong' },
        // Google Docs wraps everything in <b style="font-weight: normal">.
        { tag: 'b', getAttrs: (dom: HTMLElement) => dom.style.fontWeight !== 'normal' && null },
        {
          style: 'font-weight',
          getAttrs: (value: string) => /^(bold(er)?|[6-9]\d\d)$/.test(value) && null,
        },
      ],
      toDOM: () => ['strong', { class: 'font-semibold' }, 0],
    },
    italic: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
      toDOM: () => ['em', 0],
    },
    strike: {
      parseDOM: [
        { tag: 's' },
        { tag: 'del' },
        { tag: 'strike' },
        { style: 'text-decoration=line-through' },
      ],
      toDOM: () => ['s', 0],
    },
    code: {
      code: true,
      excludes: 'link',
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', { class: codeClass }, 0],
    },
  },
});
