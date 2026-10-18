import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_LIMITS, MCP_TOKEN_PREFIX } from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { mcpTokens } from './schema.js';
import {
  authenticateToken,
  createToken,
  listTokens,
  revokeAllTokens,
  revokeToken,
  TokenLimitError,
} from './tokens.js';

describe('MCP tokens', () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  const newAdmin = async () => addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });

  beforeAll(() => {
    ({ db, close: closeDb } = createDb(testConfig().databaseUrl));
  });
  afterAll(async () => {
    await closeDb();
  });

  it('stores only the hash and shows the secret once', async () => {
    const admin = await newAdmin();
    const { token, item } = await createToken(db, admin.id, {
      name: 'Claude',
      scope: 'read',
      expiresInDays: 30,
    });
    expect(token.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(token.length).toBeGreaterThan(40);
    expect(item).toMatchObject({ name: 'Claude', scope: 'read', lastUsedAt: null, expired: false });
    expect(token.startsWith(item.prefix)).toBe(true);
    const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, item.id));
    expect(row!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    const days = (new Date(item.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('authenticates a valid token as its user, with the scope', async () => {
    const admin = await newAdmin();
    const { token, item } = await createToken(db, admin.id, {
      name: 'a',
      scope: 'write',
      expiresInDays: 7,
    });
    const auth = await authenticateToken(db, token);
    expect(auth).toMatchObject({
      tokenId: item.id,
      scope: 'write',
      user: { id: admin.id, role: 'admin', finance: false },
    });
    const [row] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, item.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it('touches last_used_at at most once a minute', async () => {
    const admin = await newAdmin();
    const { token, item } = await createToken(db, admin.id, {
      name: 'a',
      scope: 'read',
      expiresInDays: 7,
    });
    await authenticateToken(db, token);
    const [first] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, item.id));
    await authenticateToken(db, token);
    const [second] = await db.select().from(mcpTokens).where(eq(mcpTokens.id, item.id));
    expect(second!.lastUsedAt!.getTime()).toBe(first!.lastUsedAt!.getTime());
  });

  it.each([
    ['empty', ''],
    ['another prefix', 'abc_' + 'x'.repeat(43)],
    ['unknown', MCP_TOKEN_PREFIX + 'x'.repeat(43)],
    ['far too long', MCP_TOKEN_PREFIX + 'x'.repeat(5000)],
  ])('refuses an %s token', async (_name, raw) => {
    expect(await authenticateToken(db, raw)).toBeNull();
  });

  it('refuses a revoked, an expired and a disabled user’s token', async () => {
    const admin = await newAdmin();
    const body = { name: 'a', scope: 'read' as const, expiresInDays: 7 };
    const revoked = await createToken(db, admin.id, body);
    expect(await revokeToken(db, admin.id, revoked.item.id)).toBe(true);
    expect(await authenticateToken(db, revoked.token)).toBeNull();

    const expired = await createToken(db, admin.id, body);
    await db
      .update(mcpTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(mcpTokens.id, expired.item.id));
    expect(await authenticateToken(db, expired.token)).toBeNull();
    expect((await listTokens(db, admin.id)).find((t) => t.id === expired.item.id)?.expired).toBe(
      true,
    );

    const other = await newAdmin();
    const live = await createToken(db, other.id, body);
    await deactivateUser(db, other.id);
    expect(await authenticateToken(db, live.token)).toBeNull();
  });

  it('a client’s token (should one exist) authenticates as a client: the caller refuses it', async () => {
    const client = await createUnverifiedClient(db, `${randomUUID()}@example.com`, 'Cid');
    const { token } = await createToken(db, client.id, {
      name: 'a',
      scope: 'read',
      expiresInDays: 7,
    });
    expect((await authenticateToken(db, token))?.user.role).toBe('client');
  });

  it('revokes only the owner’s own token', async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const { item } = await createToken(db, a.id, { name: 'a', scope: 'read', expiresInDays: 7 });
    expect(await revokeToken(db, b.id, item.id)).toBe(false);
    expect(await revokeToken(db, a.id, 'not-an-id')).toBe(false);
    expect((await listTokens(db, a.id)).map((t) => t.id)).toEqual([item.id]);
    expect(await revokeToken(db, a.id, item.id)).toBe(true);
    expect(await listTokens(db, a.id)).toEqual([]);
  });

  it('allows a limited number of active tokens', async () => {
    const admin = await newAdmin();
    const body = { name: 'a', scope: 'read' as const, expiresInDays: 7 };
    for (let i = 0; i < MCP_LIMITS.activeTokens; i += 1) await createToken(db, admin.id, body);
    await expect(createToken(db, admin.id, body)).rejects.toBeInstanceOf(TokenLimitError);
    const [first] = await listTokens(db, admin.id);
    await revokeToken(db, admin.id, first!.id);
    await expect(createToken(db, admin.id, body)).resolves.toBeTruthy();
  });

  it('deactivating a user revokes every token, so coming back needs new ones', async () => {
    const admin = await newAdmin();
    const { token } = await createToken(db, admin.id, {
      name: 'a',
      scope: 'read',
      expiresInDays: 7,
    });
    await deactivateUser(db, admin.id);
    await addAdmin(db, { email: admin.email, name: 'Ada again' }); // re-enables the row
    expect(await authenticateToken(db, token)).toBeNull();
    expect(await listTokens(db, admin.id)).toEqual([]);
    await revokeAllTokens(db, admin.id); // idempotent
  });
});
