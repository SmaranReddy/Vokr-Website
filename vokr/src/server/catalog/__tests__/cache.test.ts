import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { TtlCache } from "../cache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a cached value inside the TTL without calling the fetcher again", async () => {
    const cache = new TtlCache<number>(1000);
    const fetcher = vi.fn().mockResolvedValue(1);

    await expect(cache.get("k", fetcher)).resolves.toBe(1);

    fetcher.mockResolvedValue(2);
    vi.advanceTimersByTime(999);
    await expect(cache.get("k", fetcher)).resolves.toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL has elapsed", async () => {
    const cache = new TtlCache<number>(1000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await expect(cache.get("k", fetcher)).resolves.toBe(1);

    vi.advanceTimersByTime(1001);
    await expect(cache.get("k", fetcher)).resolves.toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent misses into exactly one underlying call", async () => {
    const cache = new TtlCache<number>(1000);
    let resolveFetch!: (value: number) => void;
    const fetcher = vi.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = cache.get("k", fetcher);
    const second = cache.get("k", fetcher);
    const third = cache.get("k", fetcher);

    resolveFetch(42);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      42, 42, 42,
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps separate keys independent", async () => {
    const cache = new TtlCache<number>(1000);
    await expect(cache.get("a", async () => 1)).resolves.toBe(1);
    await expect(cache.get("b", async () => 2)).resolves.toBe(2);
  });

  it("invalidate forces the next get to refetch", async () => {
    const cache = new TtlCache<number>(1000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await expect(cache.get("k", fetcher)).resolves.toBe(1);
    cache.invalidate("k");
    await expect(cache.get("k", fetcher)).resolves.toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("a rejected fetch is not cached and the next get retries", async () => {
    const cache = new TtlCache<number>(1000);
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(7);

    await expect(cache.get("k", fetcher)).rejects.toThrow("boom");
    await expect(cache.get("k", fetcher)).resolves.toBe(7);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
