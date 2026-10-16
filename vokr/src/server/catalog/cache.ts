/**
 * A generic, in-process, single-flight, TTL-based cache (R18).
 *
 * Exists so the ~6-SKU catalog can sit in Cloud Run memory instead of
 * hitting Supabase on every request — Supabase egress is the sharpest
 * free-tier cliff in the stack (Vokr-Implementation-Plan.md §3.3). The
 * single-flight guard is the part that matters under load: without it, a
 * cold instance receiving 80 concurrent requests at the moment the cache
 * expires would issue 80 identical queries instead of one.
 *
 * Keyed by a `Map` (rather than a single value) so one cache instance can
 * serve more than one logical entry if a later phase needs it — Phase 2
 * itself only ever uses one key.
 *
 * `invalidate()` bumps a per-key generation. A fetch that was already in
 * flight when the key was invalidated (it may have read stock from before
 * a reservation committed) still answers the callers waiting on it, but
 * its result is not cached and later callers do not join it — they start
 * a fresh read. Without this, a stale read could be cached for a full TTL
 * right after the invalidation meant to remove it.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  async get(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const generation = this.generations.get(key) ?? 0;
    const promise = fetcher()
      .then((value) => {
        if ((this.generations.get(key) ?? 0) === generation) {
          this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(key: string): void {
    this.store.delete(key);
    this.inflight.delete(key);
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  clear(): void {
    for (const key of new Set([...this.store.keys(), ...this.inflight.keys()])) this.invalidate(key);
  }
}
