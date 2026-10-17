import { useRef } from 'react';
import type { BulkTextNode } from '@spolu/shared';
import { AiTextButton } from '@/features/chat/ai-tools/ai-text-button';
import { ADMIN_AI_TARGET } from '@/features/chat/ai-tools/api';
import { VoiceButton } from '@/features/chat/voice-input/voice-button';
import { nodesToText, textToNodes } from './rich-text-ai';

/**
 * The microphone and the AI button of the text block's toolbar (a lazy chunk), in the admin
 * scope (the builder is for admins). The tools read the block as Markdown-like text and write it
 * back as nodes. The trees they read are remembered by their text, so Undo restores the exact
 * original and a dictation is appended to the untouched tree.
 */
export default function RichTextAiTools({
  getNodes,
  setNodes,
}: {
  getNodes(): BulkTextNode[];
  setNodes(nodes: BulkTextNode[]): void;
}) {
  const seen = useRef(new Map<string, BulkTextNode[]>());
  const latest = useRef<{ text: string; nodes: BulkTextNode[] } | null>(null);

  const getText = () => {
    const nodes = getNodes();
    const text = nodesToText(nodes);
    if (seen.current.size > 20) seen.current.clear();
    seen.current.set(text, nodes);
    latest.current = { text, nodes };
    return text;
  };
  const setText = (text: string) => {
    const exact = seen.current.get(text);
    const last = latest.current;
    if (exact) setNodes(exact);
    else if (last && text.startsWith(last.text)) {
      setNodes([...last.nodes, ...textToNodes(text.slice(last.text.length))]);
    } else setNodes(textToNodes(text));
  };

  return (
    <>
      <VoiceButton target={ADMIN_AI_TARGET} getText={getText} setText={setText} />
      <AiTextButton target={ADMIN_AI_TARGET} getText={getText} setText={setText} />
    </>
  );
}
