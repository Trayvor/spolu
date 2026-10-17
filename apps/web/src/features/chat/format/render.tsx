import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { parseMessage, safeHref, type Block, type Inline } from './parse';
import {
  bulletListClass,
  codeBlockClass,
  codeClass,
  headingClass,
  linkClass,
  orderedListClass,
  pillClass,
  quoteClass,
} from './styles';

type NameOf = (id: string) => string | undefined;

interface Labels {
  nameOf: NameOf;
  all: string;
  unknown: string;
}

const HEADING_TAG = { 1: 'h3', 2: 'h4', 3: 'h5' } as const;

/**
 * A message body as React elements. Text only ever reaches the DOM as React text children, so
 * no markup in a message can run; links are re-checked to http, https or mailto here as well.
 */
export function MessageBody({ body, nameOf }: { body: string; nameOf: NameOf }) {
  const { t } = useTranslation();
  const blocks = useMemo(() => parseMessage(body), [body]);
  const labels: Labels = { nameOf, all: t('chat.mention.all'), unknown: t('chat.mention.unknown') };
  return (
    <div className="flex min-w-0 flex-col gap-1.5 [overflow-wrap:anywhere]">
      {renderBlocks(blocks, labels)}
    </div>
  );
}

function renderBlocks(blocks: Block[], labels: Labels): ReactNode[] {
  return blocks.map((block, key) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={key} className="whitespace-pre-wrap">
            {renderInlines(block.children, labels)}
          </p>
        );
      case 'heading': {
        // h3–h5: a message sits under the page's own headings.
        const Tag = HEADING_TAG[block.level];
        return (
          <Tag key={key} className={headingClass[block.level]}>
            {renderInlines(block.children, labels)}
          </Tag>
        );
      }
      case 'codeBlock':
        return (
          <pre key={key} className={codeBlockClass}>
            <code>{block.text}</code>
          </pre>
        );
      case 'quote':
        return (
          <blockquote key={key} className={quoteClass}>
            {renderBlocks(block.children, labels)}
          </blockquote>
        );
      case 'list': {
        const items = block.items.map((item, i) => (
          <li key={i} className="whitespace-pre-wrap">
            {renderInlines(item, labels)}
          </li>
        ));
        return block.ordered ? (
          <ol key={key} start={block.start} className={orderedListClass}>
            {items}
          </ol>
        ) : (
          <ul key={key} className={bulletListClass}>
            {items}
          </ul>
        );
      }
    }
  });
}

function renderInlines(nodes: Inline[], labels: Labels): ReactNode[] {
  return nodes.map((node, key) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'break':
        return <br key={key} />;
      case 'bold':
        return (
          <strong key={key} className="font-semibold">
            {renderInlines(node.children, labels)}
          </strong>
        );
      case 'italic':
        return <em key={key}>{renderInlines(node.children, labels)}</em>;
      case 'strike':
        return <s key={key}>{renderInlines(node.children, labels)}</s>;
      case 'code':
        return (
          <code key={key} className={codeClass}>
            {node.text}
          </code>
        );
      case 'link': {
        const href = safeHref(node.href);
        if (!href) return <span key={key}>{renderInlines(node.children, labels)}</span>;
        return (
          <a
            key={key}
            href={href}
            title={href}
            target="_blank"
            rel="noreferrer noopener"
            className={linkClass}
          >
            {renderInlines(node.children, labels)}
          </a>
        );
      }
      case 'mention': {
        const name = labels.nameOf(node.userId);
        return (
          <span key={key} className={pillClass}>
            {name === undefined ? labels.unknown : `@${name}`}
          </span>
        );
      }
      case 'mentionAll':
        return (
          <span key={key} className={pillClass}>
            {labels.all}
          </span>
        );
    }
  });
}
