import { describe, expect, it } from 'vitest';
import { FileInfoSchema } from './files.js';

const valid = {
  id: 'f1',
  name: 'a.png',
  mime: 'image/png',
  size: 10,
  width: 4,
  height: 3,
  hasPreview: true,
};

describe('FileInfoSchema', () => {
  it('accepts an image and a plain file without dimensions', () => {
    expect(FileInfoSchema.parse(valid)).toEqual(valid);
    const plain = { ...valid, width: null, height: null, hasPreview: false };
    expect(FileInfoSchema.parse(plain)).toEqual(plain);
  });

  it('rejects a fractional size and a missing field', () => {
    expect(() => FileInfoSchema.parse({ ...valid, size: 1.5 })).toThrow();
    expect(() => FileInfoSchema.parse({ ...valid, hasPreview: undefined })).toThrow();
  });
});
