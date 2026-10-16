import Link from "next/link";

import type { AdminPostError } from "./use-admin-post";

/** aria-live region for mutation results and errors. */
export function FormStatus({ error, success }: { error: AdminPostError | null; success?: string | null }) {
  return (
    <div aria-live="polite" className="mt-2 text-sm">
      {error ? (
        <p role="alert" className="text-red-600">
          {error.message}
          {error.code === "UNAUTHORIZED" ? (
            <>
              {" "}
              Refunds need a sign-in within the last 15 minutes.{" "}
              <Link href="/sign-in" className="underline">
                Sign in again
              </Link>
              .
            </>
          ) : null}
          {error.requestId ? <span className="block text-muted">Request ID: {error.requestId}</span> : null}
        </p>
      ) : null}
      {success ? <p className="text-foreground">{success}</p> : null}
    </div>
  );
}
