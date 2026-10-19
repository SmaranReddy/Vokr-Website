// Shared target guard for every k6 script in this folder.
//
// These scripts generate real load. By default they refuse any host but
// this machine, so a typo or a copied command can never point them at
// vokr.shop, the production Cloud Run origin, or Supabase. A non-local
// target needs ALLOW_REMOTE_TARGET=<exact hostname> — set only for an
// isolated staging environment the owner has approved for load (plan R5).
// Production is refused even then.
//
// The production Cloud Run service is named `vokr` (project vokr-website,
// asia-south1; read 17 Oct 2026 with `gcloud run services describe vokr`).
// Both of its URLs are listed, and every run.app host whose service label
// starts with `vokr-` is refused too — that covers revision-tag URLs
// (`<tag>---vokr-…`) and any URL format change. A staging service must
// therefore be named something else (e.g. `staging-vokr`).

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "host.docker.internal"];
const PRODUCTION_RUN_APP_HOSTS = ["vokr-plxgen7xla-el.a.run.app", "vokr-978877857702.asia-south1.run.app"];
const NEVER_TARGET = [
  /(^|\.)vokr\.shop$/i,
  /^([a-z0-9-]+---)?vokr-[^.]*\..*run\.app$/i,
  /\.supabase\.co$/i,
  /\.supabase\.com$/i,
];

export function resolveTarget() {
  const base = (__ENV.BASE_URL || "http://host.docker.internal:3000").replace(/\/+$/, "");
  const match = /^https?:\/\/([^/:]+)(:\d+)?$/i.exec(base);
  if (!match) throw new Error(`BASE_URL "${base}" must be scheme://host[:port] with no path.`);
  const host = match[1].toLowerCase();
  if (PRODUCTION_RUN_APP_HOSTS.includes(host) || NEVER_TARGET.some((pattern) => pattern.test(host))) {
    throw new Error(`Refusing to load-test ${host}: production hosts are never a load target.`);
  }
  if (!LOCAL_HOSTS.includes(host) && __ENV.ALLOW_REMOTE_TARGET !== host) {
    throw new Error(`Refusing to load-test ${host}: set ALLOW_REMOTE_TARGET=${host} only for an approved isolated staging environment.`);
  }
  return base;
}

export function capVus(requested, max) {
  const vus = Number(requested);
  if (!Number.isInteger(vus) || vus < 1 || vus > max) {
    throw new Error(`VUS must be an integer between 1 and ${max}, got "${requested}".`);
  }
  return vus;
}
