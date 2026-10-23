import { describe, expect, it } from 'vitest';
import type { Role, SessionUser } from '@spolu/shared';
import {
  canConvertFile,
  canDeleteItem,
  canEditItem,
  canReadFolder,
  canReadItem,
  canSetFolderVisibility,
  canSetVisibility,
  canShareKnowledge,
  isShareableInto,
} from './policy.js';

describe('sharing knowledge in a chat (Phase 28)', () => {
  const who = (role: Role): SessionUser => ({
    id: 'x',
    email: 'x@example.com',
    name: 'X',
    role,
    finance: false,
  });

  it('whoever reads the group shares its knowledge; a ziadatel or another group never', () => {
    expect(canShareKnowledge(who('admin'), 'g1', [])).toBe(true);
    expect(canShareKnowledge(who('superadmin'), 'g1', [])).toBe(true);
    expect(canShareKnowledge(who('client'), 'g1', ['g1'])).toBe(true);
    // A ziadatel membership gives no client group ids.
    expect(canShareKnowledge(who('client'), 'g1', [])).toBe(false);
    expect(canShareKnowledge(who('client'), 'g1', ['g2'])).toBe(false);
  });

  it('only a public item of the group with every folder public is shareable', () => {
    const item = { groupId: 'g1', visibility: 'public' };
    expect(isShareableInto(item, ['public', 'public'], 'g1', 'adm')).toBe(true);
    expect(isShareableInto(item, [], 'g1', 'adm')).toBe(true);
    expect(isShareableInto(item, [], 'g1', null)).toBe(true);
    expect(isShareableInto({ ...item, visibility: 'admins' }, [], 'g1', 'adm')).toBe(false);
    expect(isShareableInto(item, ['public', 'admins'], 'g1', 'adm')).toBe(false);
    // Another client's item never goes into this client's places, public or not.
    expect(isShareableInto(item, [], 'g2', 'adm')).toBe(false);
    expect(isShareableInto(item, [], 'g2', null)).toBe(false);
  });

  it('Phase 34: an admin-group item goes into a client only while Shareable with clients', () => {
    const shared = { groupId: 'adm', visibility: 'public', type: 'note' };
    expect(isShareableInto(shared, [], 'g1', 'adm')).toBe(true);
    expect(isShareableInto(shared, ['public'], 'g2', 'adm')).toBe(true);
    // "Only eGrant", inside an "Only eGrant" folder, or a file of the team's chat: never.
    expect(isShareableInto({ ...shared, visibility: 'admins' }, [], 'g1', 'adm')).toBe(false);
    expect(isShareableInto(shared, ['public', 'admins'], 'g1', 'adm')).toBe(false);
    expect(isShareableInto({ ...shared, type: 'chat_file' }, [], 'g1', 'adm')).toBe(false);
    // Without a known admin group the item is just another group's.
    expect(isShareableInto(shared, [], 'g1', null)).toBe(false);
  });

  it('Phase 34: into the admin group goes any item of any group (its readers are admins)', () => {
    const hiddenItem = { groupId: 'g1', visibility: 'admins' };
    expect(isShareableInto(hiddenItem, ['admins'], 'adm', 'adm')).toBe(true);
    expect(isShareableInto({ groupId: 'g2', visibility: 'public' }, [], 'adm', 'adm')).toBe(true);
    expect(isShareableInto({ groupId: 'adm', visibility: 'admins' }, [], 'adm', 'adm')).toBe(true);
  });
});

const actor = (role: Role, id = 'actor'): SessionUser => ({
  id,
  email: 'a@example.com',
  name: 'A',
  role,
  finance: false,
});
const pub = { groupId: 'g1', visibility: 'public' as const, createdBy: 'author' };
const hidden = { ...pub, visibility: 'admins' as const };

describe('knowledge policy', () => {
  it('clients read public items of their group only', () => {
    expect(canReadItem(actor('client'), pub, ['g1'])).toBe(true);
    expect(canReadItem(actor('client'), pub, ['g2'])).toBe(false);
    expect(canReadItem(actor('client'), pub, [])).toBe(false);
    expect(canReadItem(actor('client'), hidden, ['g1'])).toBe(false);
  });

  it('admins read admins-only items', () => {
    expect(canReadItem(actor('admin'), hidden, [])).toBe(true);
    expect(canReadItem(actor('superadmin'), hidden, [])).toBe(true);
  });

  it('author and admins edit; another client cannot', () => {
    expect(canEditItem(actor('client', 'author'), pub, ['g1'])).toBe(true);
    expect(canEditItem(actor('admin'), pub, [])).toBe(true);
    expect(canEditItem(actor('admin'), hidden, [])).toBe(true);
    expect(canEditItem(actor('client', 'other'), pub, ['g1'])).toBe(false);
    // The author in another group (moved out) cannot edit either.
    expect(canEditItem(actor('client', 'author'), pub, ['g2'])).toBe(false);
    expect(canDeleteItem).toBe(canEditItem);
  });

  it('a client cannot set admins', () => {
    expect(canSetVisibility(actor('client'), null, 'admins')).toBe(false);
    expect(canSetVisibility(actor('client'), { authorIsClient: true }, 'admins')).toBe(false);
    expect(canSetVisibility(actor('client'), null, 'public')).toBe(true);
  });

  it("an admin cannot make a client's item admins-only", () => {
    expect(canSetVisibility(actor('admin'), { authorIsClient: true }, 'admins')).toBe(false);
    expect(canSetVisibility(actor('admin'), { authorIsClient: true }, 'public')).toBe(true);
  });

  it("an admin's item can switch either way by any admin", () => {
    expect(canSetVisibility(actor('admin'), null, 'admins')).toBe(true);
    expect(canSetVisibility(actor('admin', 'x'), { authorIsClient: false }, 'admins')).toBe(true);
    expect(canSetVisibility(actor('superadmin'), { authorIsClient: false }, 'public')).toBe(true);
  });

  it('folders: clients see public folders of their group; admins see all', () => {
    expect(canReadFolder(actor('client'), pub, ['g1'])).toBe(true);
    expect(canReadFolder(actor('client'), pub, ['g2'])).toBe(false);
    expect(canReadFolder(actor('client'), hidden, ['g1'])).toBe(false);
    expect(canReadFolder(actor('admin'), hidden, [])).toBe(true);
  });

  it('folders: only admins make a folder admins-only', () => {
    expect(canSetFolderVisibility(actor('client'), 'public')).toBe(true);
    expect(canSetFolderVisibility(actor('client'), 'admins')).toBe(false);
    expect(canSetFolderVisibility(actor('admin'), 'admins')).toBe(true);
  });
});

describe('changing a chat file into a file item', () => {
  const chatFile = { ...pub, type: 'chat_file' };

  it("its author, admins and the group's managers may; another group or a non-chat file never", () => {
    expect(canConvertFile(actor('client', 'author'), chatFile, ['g1'])).toBe(true);
    expect(canConvertFile(actor('admin'), chatFile, [])).toBe(true);
    expect(canConvertFile(actor('superadmin'), chatFile, [])).toBe(true);
    // 2026-10-23: any manager of the group (an active `client` membership), not only the author.
    expect(canConvertFile(actor('client', 'other'), chatFile, ['g1'])).toBe(true);
    // A manager of another group, the author included.
    expect(canConvertFile(actor('client', 'other'), chatFile, ['g2'])).toBe(false);
    expect(canConvertFile(actor('client', 'author'), chatFile, ['g2'])).toBe(false);
    // A ziadatel or a removed membership gives no client group ids.
    expect(canConvertFile(actor('client', 'other'), chatFile, [])).toBe(false);
    expect(canConvertFile(actor('client', 'author'), chatFile, [])).toBe(false);
    expect(canConvertFile(actor('admin'), { ...pub, type: 'file' }, [])).toBe(false);
  });

  it('ticket and task files too, by the same rule (2026-10-22, managers 2026-10-23)', () => {
    for (const type of ['ticket_file', 'task_file']) {
      const item = { ...pub, type };
      expect(canConvertFile(actor('client', 'author'), item, ['g1'])).toBe(true);
      expect(canConvertFile(actor('admin'), item, [])).toBe(true);
      expect(canConvertFile(actor('client', 'other'), item, ['g1'])).toBe(true);
      expect(canConvertFile(actor('client', 'other'), item, ['g2'])).toBe(false);
      expect(canConvertFile(actor('client', 'author'), item, ['g2'])).toBe(false);
      expect(canConvertFile(actor('client', 'other'), item, [])).toBe(false);
      // An admins-only one (the admin group's task files): admins only, its author included.
      expect(
        canConvertFile(actor('client', 'author'), { ...item, visibility: 'admins' }, ['g1']),
      ).toBe(false);
      expect(
        canConvertFile(actor('client', 'other'), { ...item, visibility: 'admins' }, ['g1']),
      ).toBe(false);
      expect(canConvertFile(actor('admin'), { ...item, visibility: 'admins' }, [])).toBe(true);
    }
  });

  it('nobody edits, moves or deletes a ticket or task file by hand', () => {
    for (const type of ['ticket_file', 'task_file']) {
      expect(canEditItem(actor('admin'), { ...pub, type }, [])).toBe(false);
      expect(canEditItem(actor('client', 'author'), { ...pub, type }, ['g1'])).toBe(false);
    }
  });

  it('never shared from the admin group into a client, like the team chat files', () => {
    for (const type of ['ticket_file', 'task_file']) {
      expect(isShareableInto({ groupId: 'adm', visibility: 'public', type }, [], 'g1', 'adm')).toBe(
        false,
      );
    }
  });
});
