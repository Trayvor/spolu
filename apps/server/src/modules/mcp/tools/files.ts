import { z } from 'zod';
import { defineTool, fromApi, idArg, type ToolDef } from './define.js';

/** The most of a file `read_file` returns (spec §2 #15); a larger one answers 413. */
const MCP_FILE_MAX_BYTES = 2 * 1024 * 1024;

const TEXT_TYPES = /^text\/|^application\/(json|xml|csv|x-ndjson)|\+xml$|\+json$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** The file name of `attachment; filename*=UTF-8''<name>`, when there is one. */
function fileName(disposition: string | undefined): string | null {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

export const fileTools: ToolDef[] = [
  defineTool({
    name: 'read_file',
    title: 'Read a file',
    description: `The content of a file the user may download (attachments of messages, tasks, tickets, knowledge items, projects; finance documents’ files only for finance admins), up to ${MCP_FILE_MAX_BYTES / 1024 / 1024} MB: text as text, images as images, anything else (PDF, Word, …) as a base64 resource.`,
    input: z.object({ fileId: idArg('file') }),
    run: async ({ api }, { fileId }) => {
      // Only the first bytes are read: the route answers a range, with the full size.
      const res = await api('GET', `/api/files/${fileId}`, {
        range: `bytes=0-${MCP_FILE_MAX_BYTES - 1}`,
        binary: true,
      });
      if (res.status === 416) {
        return { status: 200, content: [{ type: 'text', text: '(empty file)' }] };
      }
      if (res.status !== 200 && res.status !== 206) {
        return fromApi({
          status: res.status,
          body: { error: res.status === 404 ? 'not_found' : 'failed' },
        });
      }
      const total = Number(
        /\/(\d+)$/.exec(res.headers?.['content-range'] ?? '')?.[1] ?? res.raw?.length,
      );
      if (total > MCP_FILE_MAX_BYTES) {
        return {
          status: 413,
          data: { error: 'file_too_large', size: total, max: MCP_FILE_MAX_BYTES },
        };
      }
      const bytes = res.raw ?? Buffer.alloc(0);
      const mime = (res.contentType ?? 'application/octet-stream').split(';')[0]!.trim();
      const name = fileName(res.headers?.['content-disposition']);
      const label = {
        type: 'text' as const,
        text: JSON.stringify({ fileId, name, mime, size: total }),
      };
      if (TEXT_TYPES.test(mime)) {
        return { status: 200, content: [label, { type: 'text', text: bytes.toString('utf8') }] };
      }
      if (IMAGE_TYPES.has(mime)) {
        return {
          status: 200,
          content: [label, { type: 'image', data: bytes.toString('base64'), mimeType: mime }],
        };
      }
      return {
        status: 200,
        content: [
          label,
          {
            type: 'resource',
            resource: {
              uri: `spolu://files/${fileId}`,
              mimeType: mime,
              blob: bytes.toString('base64'),
            },
          },
        ],
      };
    },
  }),
];
