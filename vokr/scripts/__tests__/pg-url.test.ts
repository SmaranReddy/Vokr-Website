import { describe, expect, it } from "vitest";

import { pgEnvFromUrl } from "../lib/pg-url";

describe("BACKUP_DATABASE_URL → libpq environment", () => {
  it("parses a Supabase session-pooler URL, percent-decoding the password", () => {
    expect(pgEnvFromUrl("postgresql://postgres.abcdef:p%40ss%2Fw%3Ard@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require")).toEqual({
      PGHOST: "aws-0-ap-south-1.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: "postgres.abcdef",
      PGPASSWORD: "p@ss/w:rd",
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    });
  });

  it("defaults: port 5432, database postgres, sslmode=require for a remote host", () => {
    expect(pgEnvFromUrl("postgres://u:x@db.example.com")).toMatchObject({ PGPORT: "5432", PGDATABASE: "postgres", PGSSLMODE: "require" });
  });

  it("keeps a stricter sslmode", () => {
    expect(pgEnvFromUrl("postgresql://u:x@db.example.com/postgres?sslmode=verify-full").PGSSLMODE).toBe("verify-full");
  });

  it("allows plain connections only to a local host (rehearsals)", () => {
    expect(pgEnvFromUrl("postgresql://u:x@127.0.0.1:55432/vokr").PGSSLMODE).toBe("disable");
    expect(() => pgEnvFromUrl("postgresql://u:x@db.example.com/postgres?sslmode=disable")).toThrow(/sslmode=require/);
    expect(() => pgEnvFromUrl("postgresql://u:x@db.example.com/postgres?sslmode=prefer")).toThrow(/sslmode=require/);
  });

  it("refuses the transaction pooler, which cannot run pg_dump", () => {
    expect(() => pgEnvFromUrl("postgresql://u:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toThrow(/6543/);
  });

  it("never echoes the value in an error", () => {
    for (const bad of ["not a url secret-pw", "mysql://u:secret-pw@h/db", "postgresql://:secret-pw@h/db", "postgresql://u:secret-pw@h:6543/db"]) {
      let message = "";
      try {
        pgEnvFromUrl(bad);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message, bad).not.toBe("");
      expect(message).not.toContain("secret-pw");
    }
  });
});
