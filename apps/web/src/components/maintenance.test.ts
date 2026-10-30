import { describe, expect, it } from 'vitest';
import { upcomingMaintenance } from './maintenance';

describe('upcomingMaintenance', () => {
  const at = '2026-10-30T21:00:00+01:00';

  it('gives the start while it is still ahead', () => {
    expect(upcomingMaintenance(new Date('2026-10-30T19:59:00Z'), at)).toEqual(new Date(at));
  });

  it('gives nothing once it has started', () => {
    expect(upcomingMaintenance(new Date('2026-10-30T20:00:00Z'), at)).toBeNull();
  });

  it('gives nothing when none is planned', () => {
    expect(upcomingMaintenance(new Date('2026-10-30T12:00:00Z'), null)).toBeNull();
  });
});
