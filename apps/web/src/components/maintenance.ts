/**
 * The next planned outage (a server move, a long migration): ISO time with its offset, or null.
 * Until it starts, every screen shows a strip under the header saying when Help will be down
 * (`maintenance-strip.tsx`); afterwards nothing, so a later deploy may leave it in place. Set it
 * in a deploy before the outage (docs/runbooks/deploy.md, "Announcing an outage").
 */
export const MAINTENANCE_AT: string | null = null;

export function upcomingMaintenance(now: Date, at: string | null = MAINTENANCE_AT): Date | null {
  if (at === null) return null;
  const start = new Date(at);
  return start.getTime() > now.getTime() ? start : null;
}
