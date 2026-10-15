import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { BucketKind } from '@spolu/shared';

/** Initial keys of the four fixed buckets (admins may reorder every bucket afterwards). */
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
