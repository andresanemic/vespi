// Lore: runs the clue «En un evento presencial, toda la sala sale por una IP pública» (conjecture) in
// desarrollo-web/proyectos/vespi/lore/proyecto.md. Test it with the whole room behind one IP.
// Rate limit for the contribution routes, apart from the waitlist limiter in store.ts.
// Fixed one-minute windows, in memory of each server instance. Thursday's hub puts about 30 people
// behind one Wi-Fi IP, so the IP budget is wide and the per-key budget (the participant's public key)
// is what stops one client from hammering the sponsor.

export const PER_IP = 120;
export const PER_KEY = 10;
const WINDOW_MS = 60_000;

type Bucket = { count: number; resetAt: number };
export type RateLimitHit = { ok: true; release(): void } | { ok: false; retryAfter: number };

export function createRateLimiter({ perIp = PER_IP, perKey = PER_KEY, windowMs = WINDOW_MS } = {}) {
  const buckets = new Map<string, Bucket>();

  function current(id: string, now: number): Bucket {
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size > 5000) for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(id, bucket);
    }
    return bucket;
  }

  return {
    // Counts one call for the IP and, when the body names one, for the key. Nothing is counted when refused.
    take(ip: string, key: string | null, now = Date.now()): RateLimitHit {
      const byIp = current(`ip:${ip}`, now);
      const byKey = key === null ? null : current(`key:${key}`, now);
      const full = [byIp.count >= perIp ? byIp : null, byKey && byKey.count >= perKey ? byKey : null]
        .filter((bucket): bucket is Bucket => bucket !== null);
      if (full.length) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((Math.max(...full.map(b => b.resetAt)) - now) / 1000)) };
      }
      byIp.count++;
      if (byKey) byKey.count++;
      let released = false;
      return {
        ok: true,
        // Gives the quota back (a 'busy' answer costs nothing), only within the window it was taken from.
        release() {
          if (released) return;
          released = true;
          for (const bucket of [byIp, byKey]) {
            if (bucket && bucket.count > 0 && buckets.get(bucket === byIp ? `ip:${ip}` : `key:${key}`) === bucket) {
              bucket.count--;
            }
          }
        },
      };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

export const contributionLimiter = createRateLimiter();
