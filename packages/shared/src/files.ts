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
