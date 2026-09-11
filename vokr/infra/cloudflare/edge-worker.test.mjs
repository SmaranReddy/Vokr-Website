// Tests for the vokr.shop edge Worker (edge-worker.mjs).
//
//   node --test vokr/infra/cloudflare/edge-worker.test.mjs
//   LIVE=1 node --test vokr/infra/cloudflare/edge-worker.test.mjs   # + real origin
//
// Runs on Node's own fetch/Request/Response, which the Worker shares with
// workerd. The LIVE case sends one GET /api/health to production with a
// throwaway header value; the application ignores that header today.
import assert from "node:assert/strict";
import { test } from "node:test";

import worker, { ORIGIN_AUTH_HEADER } from "./edge-worker.mjs";

const ENV = {
  ORIGIN_HOST: "origin.example.run.app",
  ORIGIN_AUTH_SECRET: "secret-for-tests",
};

async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("fails closed with 503 when either setting is missing", async () => {
  for (const env of [{}, { ORIGIN_HOST: "x" }, { ORIGIN_AUTH_SECRET: "y" }]) {
    const res = await worker.fetch(new Request("https://vokr.shop/"), env);
    assert.equal(res.status, 503);
  }
});

test("forwards path and query to the origin, stamped with the secret", () =>
  withFetch(
    () => new Response("ok"),
    async (calls) => {
      const req = new Request("https://vokr.shop/shop/kids-model-123?size=9", {
        headers: {
          [ORIGIN_AUTH_HEADER]: "forged-by-client",
          "x-forwarded-host": "evil.example",
          accept: "text/html",
        },
      });
      const res = await worker.fetch(req, ENV);
      assert.equal(res.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "https://origin.example.run.app/shop/kids-model-123?size=9",
      );
      const h = new Headers(calls[0].init.headers);
      assert.equal(h.get(ORIGIN_AUTH_HEADER), ENV.ORIGIN_AUTH_SECRET);
      assert.equal(h.get("x-forwarded-host"), "vokr.shop");
      assert.equal(h.get("x-forwarded-proto"), "https");
      assert.equal(h.get("accept"), "text/html");
      assert.equal(h.get("host"), null);
      assert.equal(calls[0].init.redirect, "manual");
    },
  ));

test("forwards a POST body unchanged", () =>
  withFetch(
    async (_url, init) => new Response(await new Response(init.body).text()),
    async (calls) => {
      const body = '{"variantId":"v1","quantity":1}';
      const res = await worker.fetch(
        new Request("https://vokr.shop/api/cart/items", {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
        }),
        ENV,
      );
      assert.equal(await res.text(), body);
      assert.equal(calls[0].init.method, "POST");
    },
  ));

test("rewrites an absolute redirect that names the origin", () =>
  withFetch(
    () =>
      new Response(null, {
        status: 307,
        headers: {
          location: "https://origin.example.run.app/sign-in?next=%2Fcart",
        },
      }),
    async () => {
      const res = await worker.fetch(
        new Request("https://vokr.shop/cart"),
        ENV,
      );
      assert.equal(res.status, 307);
      assert.equal(
        res.headers.get("location"),
        "https://vokr.shop/sign-in?next=%2Fcart",
      );
    },
  ));

test("leaves relative and third-party redirects alone", async () => {
  for (const location of ["/sign-in", "https://accounts.example.com/x"]) {
    await withFetch(
      () => new Response(null, { status: 302, headers: { location } }),
      async () => {
        const res = await worker.fetch(new Request("https://vokr.shop/"), ENV);
        assert.equal(res.headers.get("location"), location);
      },
    );
  }
});

test(
  "live: proxies the production origin's health check",
  { skip: !process.env.LIVE },
  async () => {
    const res = await worker.fetch(
      new Request("https://vokr.shop/api/health"),
      {
        ORIGIN_HOST: "vokr-plxgen7xla-el.a.run.app",
        ORIGIN_AUTH_SECRET: "live-test-not-a-secret",
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok" });
  },
);
