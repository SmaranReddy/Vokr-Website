"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AdminPostError {
  code: string;
  message: string;
  requestId?: string;
}

/** POSTs JSON to an admin API route; refreshes the page on success. */
export function useAdminPost() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AdminPostError | null>(null);

  async function post<T>(url: string, body: unknown): Promise<T | null> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => null)) as (T & { error?: AdminPostError }) | null;
      if (!response.ok || !json || json.error) {
        const apiError = json?.error;
        setError({
          code: apiError?.code ?? "UNKNOWN",
          message: apiError?.message ?? `Request failed (${response.status}).`,
          requestId: apiError?.requestId,
        });
        return null;
      }
      router.refresh();
      return json;
    } catch {
      setError({ code: "NETWORK", message: "Network error. Reload and check whether the change was applied." });
      return null;
    } finally {
      setPending(false);
    }
  }

  return { post, pending, error };
}
