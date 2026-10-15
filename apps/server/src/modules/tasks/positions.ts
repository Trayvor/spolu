import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { BucketKind } from '@spolu/shared';

/** Keys of the four fixed buckets; custom buckets fall strictly between To do and Completed. */
export const FIXED_POSITIONS: Record<Exclude<BucketKind, 'custom'>, string> = {
  todo: 'a0',
  egrant_review: 'a3',
  client_review: 'a6',
  done: 'a9',
};

/** A key strictly between `prev` and `next` (null = open end). */
export function keyAfter(prev: string | null, next: string | null): string {
  return generateKeyBetween(prev, next);
}

/** `n` ascending keys after `prev`. */
export function keysAfter(prev: string | null, n: number): string[] {
  return generateNKeysBetween(prev, null, n);
}

/** True when a custom bucket may sit at `p`: strictly between To do and Completed, never on a fixed key. */
export function isCustomBucketPosition(p: string): boolean {
  if (!(FIXED_POSITIONS.todo < p && p < FIXED_POSITIONS.done)) return false;
  return p !== FIXED_POSITIONS.egrant_review && p !== FIXED_POSITIONS.client_review;
}
