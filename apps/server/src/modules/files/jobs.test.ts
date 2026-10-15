import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../../../test/test-app.js';
import { createGroup } from '../groups/service.js';
import { createUnverifiedClient } from '../users/service.js';
import { FILES_CLEANUP_JOB } from './jobs.js';
import { files } from './schema.js';
import { attachFiles, createFile, getFile, setFilePreview } from './service.js';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(() => ctx.close());

describe('the files cleanup job', () => {
  it('deletes an unattached 25 h old file and keeps a fresh one', async () => {
    const { db, storage, jobs } = ctx.deps;
    const group = await createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const owner = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    const upload = (name: string) =>
      createFile(
        { db, storage },
        {
          groupId: group.id,
          uploadedBy: owner.id,
          name,
          declaredType: 'text/plain',
          body: Readable.from([Buffer.from('hello')]),
        },
      );
    const stale = await upload('stale.txt');
    const fresh = await upload('fresh.txt');
    const attached = await upload('attached.txt');
    const withPreview = await upload('photo.txt');
    await attachFiles(db, group.id, [attached.id], owner.id);
    await setFilePreview({ db, storage }, (await getFile(db, withPreview.id))!, {
      body: Buffer.from('preview'),
      width: 10,
      height: 5,
    });
    const previewKey = (await getFile(db, withPreview.id))!.previewKey!;
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (const f of [stale, attached, withPreview]) {
      await db.update(files).set({ createdAt: old }).where(eq(files.id, f.id));
    }

    await jobs.send(FILES_CLEANUP_JOB, {});

    expect(await db.select().from(files).where(eq(files.id, stale.id))).toHaveLength(0);
    expect(await storage.exists(`files/${group.id}/${stale.id}`)).toBe(false);
    expect(await db.select().from(files).where(eq(files.id, withPreview.id))).toHaveLength(0);
    expect(await storage.exists(`files/${group.id}/${withPreview.id}`)).toBe(false);
    expect(await storage.exists(previewKey)).toBe(false);
    expect(await db.select().from(files).where(eq(files.id, attached.id))).toHaveLength(1);
    expect(await storage.exists(`files/${group.id}/${attached.id}`)).toBe(true);
    expect(await db.select().from(files).where(eq(files.id, fresh.id))).toHaveLength(1);
    expect(await storage.exists(`files/${group.id}/${fresh.id}`)).toBe(true);
  });
});
