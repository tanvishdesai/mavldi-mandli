/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "guest-secret-0123456789abcdef";
const TOKEN = "admin-token-0123456789abcdef0123456789";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T10:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  await t.action(api.auth.login, { password: "mavladi2026", token: TOKEN });
  return t;
}
async function firstPass(t: ReturnType<typeof convexTest>, pred: (p: any) => boolean = () => true) {
  const cat = await t.query(api.public.catalogue, {});
  return cat.venues.flatMap((v: any) => v.passes).filter((p: any) => p.date).find(pred);
}
const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });
async function proof(t: ReturnType<typeof convexTest>, code: string, utr = "412345678901", blob = png()) {
  const storageId = await t.run((ctx) => ctx.storage.store(blob));
  return t.action(api.public.submitPayment, { code, secret: SECRET, utr, storageId });
}
const err = async (p: Promise<unknown>) => {
  try { await p; } catch (e: any) { return e.data?.message ?? e.message; }
  throw new Error("expected an error");
};

test("catalogue shows seeded venues and live availability", async () => {
  const t = await setup();
  const cat = await t.query(api.public.catalogue, {});
  expect(cat.venues).toHaveLength(2);
  expect(cat.venues[0].passes.every((p: any) => p.available === p.quantity)).toBe(true);
});

test("booking validates input", async () => {
  const t = await setup();
  const p = await firstPass(t);
  expect(await err(t.mutation(api.public.createBooking, { name: "A", phone: "9876543210", items: [{ passId: p.id, qty: 1 }], secret: SECRET }))).toMatch(/full name/);
  expect(await err(t.mutation(api.public.createBooking, { name: "Asha", phone: "12345", items: [{ passId: p.id, qty: 1 }], secret: SECRET }))).toMatch(/mobile/);
  expect(await err(t.mutation(api.public.createBooking, { name: "Asha", phone: "9876543210", items: [], secret: SECRET }))).toMatch(/at least one/);
  expect(await err(t.mutation(api.public.createBooking, { name: "Asha", phone: "9876543210", items: [{ passId: p.id, qty: 1 }], secret: "short" }))).toMatch(/refresh/);
});

test("full lifecycle: book → pay → admin confirms → gate", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code, amount } = await t.mutation(api.public.createBooking, { name: "Riya Patel", phone: "+91 98765 43210", items: [{ passId: p.id, qty: 2 }], secret: SECRET });
  expect(amount).toBe(p.price * 2);
  const view: any = await t.query(api.public.booking, { code, secret: SECRET });
  expect(view.status).toBe("awaiting_payment");
  expect(view.payment.uri).toContain(`am=${p.price * 2}.00`);
  expect(await t.query(api.public.booking, { code, secret: "wrong-secret-xxxxxxxxxxxx" })).toBeNull();
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBe(p.quantity - 2);

  expect((await proof(t, code)).error).toBeNull();
  expect(((await t.query(api.public.booking, { code, secret: SECRET })) as any).status).toBe("pending");

  // admin side needs a session
  expect(await err(t.query(api.admin.stats, { token: "nope" }))).toMatch(/sign in/);
  const list = await t.query(api.admin.listBookings, { token: TOKEN, status: "pending", paginationOpts: { numItems: 20, cursor: null } });
  const row = list.page.find((b: any) => b.code === code)!;
  expect(row.screenshot).toBe(true);
  const detail: any = await t.query(api.admin.getBooking, { token: TOKEN, id: row.id });
  expect(detail.screenshot_url).toBeTruthy();

  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "confirm" });
  expect(((await t.query(api.public.booking, { code, secret: SECRET })) as any).status).toBe("confirmed");
  const stats = await t.query(api.admin.stats, { token: TOKEN });
  expect(stats.byStatus.find((s: any) => s.status === "confirmed")).toMatchObject({ n: 1, amount: p.price * 2 });
  expect(stats.inventory.find((i: any) => i.id === p.id)).toMatchObject({ held: 2, confirmed: 2 });

  // 1 Oct is not the pass's night: refused unless forced, and only once per night
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "checkin" }))).toMatch(/not tonight/);
  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "checkin", force: true });
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "checkin", force: true }))).toMatch(/Already/);
});

test("cannot oversell; cancelling an unpaid hold frees stock", async () => {
  const t = await setup();
  const p = await firstPass(t);
  await t.mutation(api.admin.savePass, { token: TOKEN, id: p.id, venueId: (await t.query(api.admin.passes, { token: TOKEN })).find((x: any) => x.id === p.id)!.venueId, date: p.date, label: p.label, price: p.price, quantity: 1, maxPerBooking: 5, admits: 1, active: true, sort: 1 });
  const a = await t.mutation(api.public.createBooking, { name: "One", phone: "9000000001", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  expect(await err(t.mutation(api.public.createBooking, { name: "Two", phone: "9000000002", items: [{ passId: p.id, qty: 1 }], secret: SECRET }))).toMatch(/sold out/);
  await t.mutation(api.public.cancelBooking, { code: a.code, secret: SECRET });
  await t.mutation(api.public.createBooking, { name: "Two", phone: "9000000002", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
});

test("holds expire on schedule; late proof re-reserves when stock remains", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Late", phone: "9000000003", items: [{ passId: p.id, qty: 3 }], secret: SECRET });
  vi.advanceTimersByTime(31 * 60_000);
  await t.finishInProgressScheduledFunctions();
  expect(((await t.query(api.public.booking, { code, secret: SECRET })) as any).status).toBe("expired");
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBe(p.quantity);
  expect((await proof(t, code)).error).toBeNull();
  expect(((await t.query(api.public.booking, { code, secret: SECRET })) as any).status).toBe("pending");
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBe(p.quantity - 3);
});

test("reject and re-upload flow; duplicate UTR flagged", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const a = await t.mutation(api.public.createBooking, { name: "Dup A", phone: "9000000004", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  const b = await t.mutation(api.public.createBooking, { name: "Dup B", phone: "9000000005", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  await proof(t, a.code, "555566667777");
  await proof(t, b.code, "555566667777");
  const list = await t.query(api.admin.listBookings, { token: TOKEN, q: b.code, paginationOpts: { numItems: 5, cursor: null } });
  const detail: any = await t.query(api.admin.getBooking, { token: TOKEN, id: list.page[0].id });
  expect(detail.duplicate_utr).toHaveLength(1);

  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: detail.id, action: "reupload", note: "Blurry screenshot" });
  const v: any = await t.query(api.public.booking, { code: b.code, secret: SECRET });
  expect(v.status).toBe("awaiting_payment");
  expect(v.message).toBe("Blurry screenshot");
  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: detail.id, action: "reject", note: "No payment received" });
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBe(p.quantity - 1);
});

test("non-image uploads are refused", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Bad File", phone: "9000000006", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  expect(await err(proof(t, code, "412345678901", new Blob(["<script>"], { type: "text/html" })))).toMatch(/JPG, PNG/);
});

test("admin auth: wrong password, change password signs out others", async () => {
  const t = await setup();
  expect(await err(t.action(api.auth.login, { password: "nope", token: "x".repeat(40) }))).toMatch(/Wrong password/);
  expect((await t.query(api.auth.me, { token: TOKEN })).default_password).toBe(true);
  const other = "y".repeat(40);
  await t.action(api.auth.login, { password: "mavladi2026", token: other });
  await t.action(api.auth.changePassword, { token: TOKEN, current: "mavladi2026", next: "a-better-password" });
  expect((await t.query(api.auth.me, { token: other })).admin).toBe(false);
  expect((await t.query(api.auth.me, { token: TOKEN })).default_password).toBe(false);
  await t.action(api.auth.login, { password: "a-better-password", token: other });
});

test("admin CRUD: venue, bulk nights, settings, lookup, delete keeps counters right", async () => {
  const t = await setup();
  const venueId = await t.mutation(api.admin.saveVenue, { token: TOKEN, name: "Test Ground", active: true, sort: 9 });
  expect(await t.mutation(api.admin.bulkPasses, { token: TOKEN, venueId, from: "2026-10-11", to: "2026-10-19", label: "Daily", price: 100, quantity: 50, maxPerBooking: 10, admits: 1, active: true, sort: 0 })).toBe(9);
  expect(await err(t.mutation(api.admin.saveSettings, { token: TOKEN, values: { upi_id: "not a upi" } }))).toMatch(/UPI ID/);
  await t.mutation(api.admin.saveSettings, { token: TOKEN, values: { upi_id: "mandli@okaxis" } });
  const cfg = await t.query(api.public.config, {});
  expect(cfg.upi_id).toBe("mandli@okaxis");
  expect(Object.keys(cfg)).not.toContain("admin_password_hash");

  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Look Up", phone: "9000000007", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  expect((await t.mutation(api.public.lookup, { code: code.toLowerCase(), phone: "919000000007" })).secret).toBe(SECRET);
  expect(await err(t.mutation(api.public.lookup, { code, phone: "9999999999" }))).toMatch(/No booking/);

  const row = (await t.query(api.admin.listBookings, { token: TOKEN, q: code, paginationOpts: { numItems: 5, cursor: null } })).page[0];
  await t.mutation(api.admin.deleteBooking, { token: TOKEN, id: row.id });
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBe(p.quantity);
  const stats = await t.query(api.admin.stats, { token: TOKEN });
  expect(stats.byStatus.find((s: any) => s.status === "awaiting_payment")?.n ?? 0).toBe(0);
  // a venue with passes on hold can't be deleted; an empty one can
  const held = await t.mutation(api.public.createBooking, { name: "Holder", phone: "9000000008", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  expect(held.code).toBeTruthy();
  const main = (await t.query(api.admin.venues, { token: TOKEN })).find((x: any) => x.pass_count && x.name.startsWith("Maa"))!;
  expect(await err(t.mutation(api.admin.deleteVenue, { token: TOKEN, id: main.id }))).toMatch(/booked or held/);
  await t.mutation(api.admin.deleteVenue, { token: TOKEN, id: venueId });
});
