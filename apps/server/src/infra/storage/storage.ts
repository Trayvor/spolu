import type { Readable } from 'node:stream';

export interface Storage {
  put(key: string, data: Buffer | Readable, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; contentType: string; size: number }>;
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
