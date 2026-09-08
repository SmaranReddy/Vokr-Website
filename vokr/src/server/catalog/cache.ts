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
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

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

    const promise = fetcher()
      .then((value) => {
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
