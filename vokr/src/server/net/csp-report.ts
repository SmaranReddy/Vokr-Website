/**
 * CSP violation reports (plan §5 Phase 16, task 2): parsed, reduced to
 * what is useful and safe to keep, and logged. Never stored in the
 * database. Report bodies come from any browser on the internet, so:
 *
 * - the body is capped ({@link MAX_REPORT_BYTES}) before it is parsed;
 * - at most {@link MAX_VIOLATIONS_PER_REPORT} violations are logged per request;
 * - URLs are cut to origin + path — query strings and fragments can carry
 *   tokens or personal data and never reach the logs;
 * - logging is capped per instance ({@link LOG_LIMIT_PER_MINUTE}) so a
 *   flood costs bounded Cloud Logging volume, without a database write.
 */

export const MAX_REPORT_BYTES = 16 * 1024;
export const MAX_VIOLATIONS_PER_REPORT = 5;
export const LOG_LIMIT_PER_MINUTE = 100;

export interface CspViolation {
  directive: string;
  blocked: string;
  document: string;
  disposition: string;
}

const KEYWORDS = new Set(["inline", "eval", "data", "blob", "self", "wasm-eval", "trusted-types-policy"]);

/** `https://x.example/a/b?token=1#f` → `https://x.example/a/b`; CSP keywords kept as-is; anything else → `"other"`. */
export function safeUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "none";
  if (KEYWORDS.has(value)) return value;
  try {
    const url = new URL(value);
    // `javascript:`, `data:` and the like have no origin and their "path"
    // is the payload itself: keep only the scheme.
    if (url.protocol !== "https:" && url.protocol !== "http:") return url.protocol;
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    return "other";
  }
}

function text(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 100) : fallback;
}

function fromBody(body: Record<string, unknown>): CspViolation {
  return {
    directive: text(body["effective-directive"] ?? body["violated-directive"] ?? body.effectiveDirective),
    blocked: safeUrl(body["blocked-uri"] ?? body.blockedURL),
    document: safeUrl(body["document-uri"] ?? body.documentURL),
    disposition: text(body.disposition, "report"),
  };
}

/**
 * Both report formats: the legacy `report-uri` body
 * (`{"csp-report": {...}}`) and the Reporting API's array of
 * `{type: "csp-violation", body: {...}}`.
 */
export function parseCspReport(raw: string): CspViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const bodies: Record<string, unknown>[] = [];
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const item = entry as { type?: unknown; body?: unknown };
      if (item?.type === "csp-violation" && item.body && typeof item.body === "object") {
        bodies.push(item.body as Record<string, unknown>);
      }
    }
  } else if (parsed && typeof parsed === "object" && "csp-report" in parsed) {
    const report = (parsed as Record<string, unknown>)["csp-report"];
    if (report && typeof report === "object") bodies.push(report as Record<string, unknown>);
  }
  return bodies.slice(0, MAX_VIOLATIONS_PER_REPORT).map(fromBody);
}

/** Per-instance, per-minute log budget. */
export class LogBudget {
  private windowStart = 0;
  private used = 0;
  constructor(private readonly limit = LOG_LIMIT_PER_MINUTE) {}
  take(now: number = Date.now()): boolean {
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}

/** Reads at most `limit` bytes of a request body; `null` when it is larger. */
export async function readCapped(request: Request, limit = MAX_REPORT_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
