import type { Readable } from 'node:stream';
import type { FileInfo } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { createFile, setFilesFinanceOnly } from '../files/service.js';

/**
 * A finance file (Phase 32 part B, spec §2.3): uploaded to the client's group like any file, then
 * marked finance-only before its id leaves the server, so from its first answer it opens for
 * finance admins only and attaches only to a finance item (`attachFiles(…, { finance: true })`).
 */
export async function uploadFinanceFile(
  deps: { db: Db; storage: Storage },
  input: {
    groupId: string;
    uploadedBy: string;
    name: string;
    declaredType: string | undefined;
    body: Readable;
  },
): Promise<FileInfo> {
  const info = await createFile(deps, input);
  await setFilesFinanceOnly(deps.db, [info.id]);
  return info;
}
