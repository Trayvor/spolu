import type { Readable } from 'node:stream';

export interface Storage {
  put(key: string, data: Buffer | Readable, contentType: string): Promise<void>;
  /**
   * The object's stream; with `range` only bytes `start`..`end` (inclusive, within the object),
   * while `size` stays the whole object's size.
   */
  get(
    key: string,
    range?: { start: number; end: number },
  ): Promise<{ stream: Readable; contentType: string; size: number }>;
  /**
   * The object's path on this machine when the storage is a local disk (ffmpeg reads a meeting
   * recording in place, Phase 30); null otherwise. Throws for an invalid key.
   */
  localPath(key: string): string | null;
  /** Duplicates an object (data and content type) under another key; a missing source throws StorageNotFoundError. */
  copy(fromKey: string, toKey: string): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signUrl(key: string, ttlSeconds: number): string;
  verifySignature(key: string, expires: number, sig: string): boolean;
}

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key)}`);
    this.name = 'InvalidStorageKeyError';
  }
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Storage key not found: ${key}`);
    this.name = 'StorageNotFoundError';
  }
}
