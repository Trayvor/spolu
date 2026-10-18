import { z } from 'zod';

export const FileInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  hasPreview: z.boolean(),
});
export type FileInfo = z.infer<typeof FileInfoSchema>;

// Standard alphabet with padding, no whitespace: the length check makes the padding correct.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strict base64 (files sent whole by the eGrant webhooks): standard alphabet, padded, no spaces. */
export const isStrictBase64 = (value: string): boolean =>
  value.length % 4 === 0 && BASE64.test(value);

/** The decoded length of strict base64, without decoding it. */
export function base64DecodedSize(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}
