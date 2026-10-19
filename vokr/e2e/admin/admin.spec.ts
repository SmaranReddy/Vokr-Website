/**
 * /admin in a real browser with a real Supabase session (plan §5 Phase 12).
 *
 * Local only. Runs against a production build wired to a **local** Supabase
 * stack (`npx supabase start`) and a local Postgres seeded by
 * `e2e/admin/seed.ts`; see `docs/infrastructure/fulfilment.md` → "Admin
 * browser test". Skipped unless ADMIN_E2E_BASE_URL and ADMIN_E2E_DATABASE_URL
 * are set, so `npx playwright test` elsewhere (and CI) never runs it.
 *
 *   ADMIN_E2E_BASE_URL=http://localhost:3003 \
 *   ADMIN_E2E_DATABASE_URL=postgresql://…@localhost:55432/vokr_admin_e2e \
 *   npx playwright test -c playwright.admin.config.ts
 *
 * Users sign up through the real form; admin is granted the only way it
 * can be — SQL on the (local) database. Nothing here bypasses a guard.
 */
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const BASE_URL = process.env.ADMIN_E2E_BASE_URL;
const DATABASE_URL = process.env.ADMIN_E2E_DATABASE_URL;
const SHOTS = "e2e/admin/.artifacts";

test.skip(!BASE_URL || !DATABASE_URL, "local admin e2e: set ADMIN_E2E_BASE_URL and ADMIN_E2E_DATABASE_URL");
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
// Stable local-only accounts: created once, then reused (sign-up is rate limited per IP).
const ADMIN = { email: "admin@e2e.test", password: "Local-e2e-admin-1" };
const SHOPPER = { email: "shopper@e2e.test", password: "Local-e2e-shopper-1" };

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const url = new URL(DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.includes("e2e")) {
    throw new Error("ADMIN_E2E_DATABASE_URL must be a local *e2e* database.");
  }
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** The page's own auth form, not the footer's newsletter email field. */
function authForm(page: Page) {
  return page.locator("form", { has: page.getByLabel("Password") });
}

/** The form a submit button belongs to: several admin forms share a "Reason" label. */
function formWith(page: Page, button: string) {
  return page.locator("form", { has: page.getByRole("button", { name: button }) });
}

async function signUp(page: Page, user: { email: string; password: string }) {
  if ((await sql("SELECT 1 FROM app_users WHERE email = $1", [user.email])).length === 1) return;
  await page.goto("/sign-up");
  const form = authForm(page);
  await form.getByLabel("Email").fill(user.email);
  await form.getByLabel("Password").fill(user.password);
  await form.getByRole("button").click();
  await expect.poll(async () => (await sql("SELECT 1 FROM app_users WHERE email = $1", [user.email])).length).toBe(1);
}

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/sign-in");
  const form = authForm(page);
  await form.getByLabel("Email").fill(user.email);
  await form.getByLabel("Password").fill(user.password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function status(page: Page, path: string): Promise<number> {
  const response = await page.goto(path);
  return response?.status() ?? 0;
}

async function orderNumbers(): Promise<string[]> {
  const rows = await sql<{ order_number: string }>("SELECT order_number FROM orders WHERE status = 'confirmed' ORDER BY placed_at");
  return rows.map((row) => row.order_number);
}

test("signed out: every admin surface is a 404", async ({ page, request }) => {
  for (const path of ["/admin", "/admin/orders", "/admin/inventory", "/admin/exceptions", "/%61dmin"]) {
    expect(await status(page, path), path).toBe(404);
  }
  expect((await request.get("/api/admin/exports/shiprocket?status=preparing")).status()).toBe(404);
});

test("a signed-in shopper without the flag gets the same 404", async ({ page }) => {
  await signUp(page, SHOPPER);
  await signIn(page, SHOPPER);
  expect(await status(page, "/admin")).toBe(404);
  expect(await status(page, "/admin/orders")).toBe(404);
  const api = await page.request.post("/api/admin/inventory/adjust", { data: {}, headers: { origin: BASE_URL! } });
  expect(api.status()).toBe(404);
});

test.describe("an admin", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signUp(page, ADMIN);
    await page.close();
    const granted = await sql("UPDATE app_users SET is_admin = true WHERE email = $1 AND deleted_at IS NULL RETURNING id", [ADMIN.email]);
    expect(granted).toHaveLength(1);
  });

  test("works the whole panel", async ({ page }) => {
    const [first, second, third] = await orderNumbers();
    expect(third, "seed at least 3 confirmed orders with e2e/admin/seed.ts").toBeTruthy();
    await signIn(page, ADMIN);

    // Dashboard and navigation.
    expect(await status(page, "/admin")).toBe(200);
    await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });
    await page.getByRole("link", { name: "Orders", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/orders/);
    await expect(page.getByRole("link", { name: first, exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-orders.png`, fullPage: true });

    // Order detail → preparing → shipped with courier + AWB.
    await page.getByRole("link", { name: first, exact: true }).click();
    await expect(page.getByRole("heading", { name: new RegExp(first) })).toBeVisible();
    await page.getByLabel("Move to").selectOption("preparing");
    await page.getByLabel("Note (optional)").fill("packing (e2e)");
    await page.getByRole("button", { name: "Change status" }).click();
    await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM orders WHERE order_number = $1", [first]))[0]?.status).toBe("preparing");
    await page.reload();
    await page.getByLabel("Move to").selectOption("shipped");
    await page.getByLabel("Courier").fill("Delhivery");
    await page.getByLabel("AWB").fill(`E2E${run}`.toUpperCase());
    await page.getByRole("button", { name: "Change status" }).click();
    await expect
      .poll(async () => (await sql<{ status: string; awb: string | null }>("SELECT status, awb FROM orders WHERE order_number = $1", [first]))[0])
      .toEqual({ status: "shipped", awb: `E2E${run}`.toUpperCase() });
    const shippedEmail = await sql("SELECT 1 FROM email_log e JOIN orders o ON o.id = e.order_id WHERE o.order_number = $1 AND e.template = 'order_shipped'", [first]);
    expect(shippedEmail).toHaveLength(1);
    await page.reload();
    await page.screenshot({ path: `${SHOTS}/03-order-shipped.png`, fullPage: true });

    // An illegal transition is not offered (shipped cannot go back to confirmed).
    await expect(page.getByLabel("Move to").locator("option[value=confirmed]")).toHaveCount(0);

    // Audited PII reveal.
    const reveal = formWith(page, "Reveal customer details");
    await reveal.getByLabel("Reason (3-300 characters)").fill("e2e: confirm address");
    await reveal.getByRole("button", { name: "Reveal customer details" }).click();
    await expect(page.getByText("Address", { exact: true })).toBeVisible();
    const reveals = await sql("SELECT 1 FROM audit_log WHERE action = 'pii.reveal'");
    expect(reveals.length).toBeGreaterThanOrEqual(1);

    // Shiprocket CSV for orders in `preparing`.
    await page.goto(`/admin/orders/${encodeURIComponent(second)}`);
    await page.getByLabel("Move to").selectOption("preparing");
    await page.getByRole("button", { name: "Change status" }).click();
    await expect.poll(async () => (await sql<{ status: string }>("SELECT status FROM orders WHERE order_number = $1", [second]))[0]?.status).toBe("preparing");
    await page.goto("/admin/orders");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /shiprocket csv \(preparing\)/i }).click()]);
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.split(/\r?\n/)[0]).toContain("*Order Id");
    expect(csv).toContain(second);
    expect(csv).not.toContain(first);
    expect(await sql("SELECT 1 FROM audit_log WHERE action = 'export.shiprocket'")).not.toHaveLength(0);

    // Full refund queued (Razorpay is not configured locally: it stays `open`).
    await page.goto(`/admin/orders/${encodeURIComponent(third)}`);
    const refund = formWith(page, "Queue full refund");
    await refund.getByLabel(/Retype the order number/).fill(third);
    await refund.getByLabel("Reason (3-300 characters)").fill("e2e: customer cancelled");
    await refund.getByRole("button", { name: "Queue full refund" }).click();
    await expect
      .poll(async () => (await sql("SELECT 1 FROM payment_issues pi JOIN payments p ON p.provider_payment_id = pi.provider_payment_id JOIN orders o ON o.payment_id = p.id WHERE o.order_number = $1 AND pi.reason = 'admin_refund'", [third])).length)
      .toBe(1);
    await page.reload();
    await page.screenshot({ path: `${SHOTS}/04-refund-queued.png`, fullPage: true });

    // Inventory: a change applies once; the same stale form is refused.
    await page.goto("/admin/inventory");
    await page.screenshot({ path: `${SHOTS}/05-inventory.png`, fullPage: true });
    const change = page.getByLabel(/^Change for /).first();
    const sku = ((await change.getAttribute("aria-label")) ?? (await page.locator("label", { has: change }).innerText())).match(/VK-[A-Z0-9-]+|[A-Z0-9-]{6,}/)?.[0];
    const before = (await sql<{ quantity_on_hand: number }>("SELECT i.quantity_on_hand FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = $1", [sku]))[0]?.quantity_on_hand;
    await change.fill("4");
    await page.getByLabel(/^Reason for /).first().fill("e2e: launch stock");
    await page.getByRole("button", { name: "Adjust" }).first().click();
    await expect
      .poll(async () => (await sql<{ quantity_on_hand: number }>("SELECT i.quantity_on_hand FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.sku = $1", [sku]))[0]?.quantity_on_hand)
      .toBe((before ?? 0) + 4);
    expect(await sql("SELECT 1 FROM audit_log WHERE action = 'inventory.adjust'")).not.toHaveLength(0);

    // Exceptions page renders the queued refund.
    expect(await status(page, "/admin/exceptions")).toBe(200);
    await expect(page.getByText(/admin_refund|admin refund/i).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-exceptions.png`, fullPage: true });

    // Every action carries this admin as the actor.
    const actors = await sql<{ actor: string }>("SELECT DISTINCT actor FROM audit_log");
    const [{ id }] = await sql<{ id: string }>("SELECT id FROM app_users WHERE email = $1", [ADMIN.email]);
    expect(actors.map((row) => row.actor)).toContain(`admin:${id}`);
  });

  test("losing the flag closes the panel at once", async ({ page }) => {
    await signIn(page, ADMIN);
    expect(await status(page, "/admin")).toBe(200);
    await sql("UPDATE app_users SET is_admin = false WHERE email = $1", [ADMIN.email]);
    expect(await status(page, "/admin")).toBe(404);
    await sql("UPDATE app_users SET is_admin = true WHERE email = $1", [ADMIN.email]);
  });
});
