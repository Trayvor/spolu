import { afterEach, describe, expect, it } from 'vitest';
import { clearDrafts, draftKey, readDraft, removeDraft, saveDraft } from './drafts';

afterEach(clearDrafts);

describe('chat drafts', () => {
  it('keeps one draft per chat and composer kind', () => {
    saveDraft(draftKey('c1'), 'main');
    saveDraft(draftKey('c1', 'm1'), 'thread');
    saveDraft(draftKey('c2'), 'other');
    expect(readDraft(draftKey('c1'))).toBe('main');
    expect(readDraft(draftKey('c1', 'm1'))).toBe('thread');
    expect(readDraft(draftKey('c2'))).toBe('other');
    expect(readDraft(draftKey('c3'))).toBe('');
  });

  it('an empty or blank draft removes the entry', () => {
    saveDraft(draftKey('c1'), 'hi');
    saveDraft(draftKey('c1'), '  \n');
    expect(readDraft(draftKey('c1'))).toBe('');
  });

  it('removeDraft forgets it', () => {
    saveDraft(draftKey('c1'), 'hi');
    removeDraft(draftKey('c1'));
    expect(readDraft(draftKey('c1'))).toBe('');
  });
});
