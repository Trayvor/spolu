/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures until part C fills them */
import type { Server as SocketIOServer } from 'socket.io';
import type { AddRateBody, Rate, RatesDto, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * Hourly rates (Phase 32, spec §3.4, decision 10): part C owns this file and replaces the stubs.
 */

const notImplemented = (): never => {
  throw new Error('not implemented (Phase 32 part C)');
};

export async function listRates(_db: Db): Promise<RatesDto> {
  return notImplemented();
}

export async function addRate(
  _deps: { db: Db; io: SocketIOServer },
  _actor: SessionUser,
  _input: AddRateBody,
): Promise<Rate> {
  return notImplemented();
}

export async function deleteRate(
  _deps: { db: Db; io: SocketIOServer },
  _actor: SessionUser,
  _id: string,
): Promise<void> {
  return notImplemented();
}
