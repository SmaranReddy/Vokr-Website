/**
 * Turns a Postgres connection URL (the `BACKUP_DATABASE_URL` secret) into
 * the libpq environment `pg_dump` reads, so the credential is passed to the
 * child process through its environment — never as an argument, where it
 * would show in the process list — and is never logged.
 *
 * Refuses the two connections that cannot take a whole-database dump: the
 * Supabase transaction pooler (port 6543, no session state) and an
 * unencrypted connection to anything but a local host.
 */
export interface PgEnv {
  PGHOST: string;
  PGPORT: string;
  PGUSER: string;
  PGPASSWORD: string;
  PGDATABASE: string;
  PGSSLMODE: string;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal", "postgres"]);

export function pgEnvFromUrl(value: string): PgEnv {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Never echo the value: it holds the password.
    throw new Error("BACKUP_DATABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("BACKUP_DATABASE_URL must start with postgresql://.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port || "5432";
  if (!host || !url.username) throw new Error("BACKUP_DATABASE_URL needs a host and a user.");
  if (port === "6543") {
    throw new Error("BACKUP_DATABASE_URL uses port 6543 (Supabase transaction pooler); pg_dump needs the session pooler on 5432.");
  }
  const sslmode = url.searchParams.get("sslmode") ?? (LOCAL.has(host) ? "disable" : "require");
  if (!LOCAL.has(host) && (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer")) {
    throw new Error(`BACKUP_DATABASE_URL must use sslmode=require (or stricter) for a remote host, not ${sslmode}.`);
  }
  return {
    PGHOST: host,
    PGPORT: port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: sslmode,
  };
}
