/** Date arithmetic shared by the derivation modules. */

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/**
 * Months between an ISO timestamp and `now`.
 *
 * A missing or unparseable date reads as old rather than as brand new. Every
 * caller uses this to decay a weight, so failing toward "stale" means bad data
 * can only ever understate a signal — never invent one.
 */
export function monthsSince(iso: string | null | undefined, now: Date): number {
  if (!iso) {
    return Number.POSITIVE_INFINITY;
  }

  const then = new Date(iso).getTime();

  if (!Number.isFinite(then)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (now.getTime() - then) / MS_PER_MONTH);
}
