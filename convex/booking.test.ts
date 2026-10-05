/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "guest-secret-0123456789abcdef";
const TOKEN = "admin-token-0123456789abcdef0123456789";
/* There is no built-in admin password any more: it has to come from the
   deployment environment, so the tests supply one the way production does. */
const PASSWORD = "test-admin-password";
process.env.ADMIN_PASSWORD = PASSWORD;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T10:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.run, {});
  await t.action(api.auth.login, { password: PASSWORD, token: TOKEN });
  return t;
}
/** The content type Convex would actually serve for a booking's screenshot. */
async function storedType(t: ReturnType<typeof convexTest>, code: string) {
  return t.run(async (ctx: any) => {
    const b = await ctx.db.query("bookings").withIndex("by_code", (q: any) => q.eq("code", code)).unique();
    const blob = await ctx.storage.get(b!.screenshotId!);
    return blob!.type;
  });
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

test("one UTR can back only one live booking", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const a = await t.mutation(api.public.createBooking, { name: "Dup A", phone: "9000000004", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  const b = await t.mutation(api.public.createBooking, { name: "Dup B", phone: "9000000005", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  expect((await proof(t, a.code, "555566667777")).error).toBeNull();
  // the same payment cannot be presented a second time — refused, not merely flagged
  expect(await err(proof(t, b.code, "555566667777"))).toMatch(/already recorded against booking/);
  expect(((await t.query(api.public.booking, { code: b.code, secret: SECRET })) as any).status).toBe("awaiting_payment");

  // an admin cannot confirm past it either, unless they explicitly override
  const rowA = (await t.query(api.admin.listBookings, { token: TOKEN, q: a.code, paginationOpts: { numItems: 5, cursor: null } })).page[0];
  await t.run(async (ctx: any) => {
    const doc = await ctx.db.query("bookings").withIndex("by_code", (q: any) => q.eq("code", b.code)).unique();
    await ctx.db.patch(doc._id, { utr: "555566667777" }); // simulate a hand-edited clash
  });
  const rowB = (await t.query(api.admin.listBookings, { token: TOKEN, q: b.code, paginationOpts: { numItems: 5, cursor: null } })).page[0];
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: rowB.id, action: "confirm" }))).toMatch(/only pay for one booking/);
  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: rowB.id, action: "confirm", force: true });
  expect(await t.run(async (ctx: any) => (await ctx.db.query("auditLog").collect()).some((r: any) => r.action === "booking.confirm_duplicate_utr"))).toBe(true);
  expect(rowA.id).toBeTruthy();
});

test("reject and re-upload flow", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const b = await t.mutation(api.public.createBooking, { name: "Dup B", phone: "9000000005", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  await proof(t, b.code, "555566667778");
  const list = await t.query(api.admin.listBookings, { token: TOKEN, q: b.code, paginationOpts: { numItems: 5, cursor: null } });
  const detail: any = await t.query(api.admin.getBooking, { token: TOKEN, id: list.page[0].id });

  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: detail.id, action: "reupload", note: "Blurry screenshot" });
  const v: any = await t.query(api.public.booking, { code: b.code, secret: SECRET });
  expect(v.status).toBe("awaiting_payment");
  expect(v.message).toBe("Blurry screenshot");
  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: detail.id, action: "reject", note: "No payment received" });
  // rejecting releases the hold, so the stock comes back
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBe(p.quantity);
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
  const other = "y".repeat(40);
  await t.action(api.auth.login, { password: PASSWORD, token: other });
  expect(await err(t.action(api.auth.changePassword, { token: TOKEN, current: PASSWORD, next: "tooshort" }))).toMatch(/at least 12/);
  await t.action(api.auth.changePassword, { token: TOKEN, current: PASSWORD, next: "a-better-password" });
  expect((await t.query(api.auth.me, { token: other })).admin).toBe(false);
  await t.action(api.auth.login, { password: "a-better-password", token: other });
});

test("a short session token is refused, and sessions expire", async () => {
  const t = await setup();
  expect(await err(t.action(api.auth.login, { password: PASSWORD, token: "tooshort" }))).toMatch(/refresh/);
  expect((await t.query(api.auth.me, { token: TOKEN })).admin).toBe(true);
  vi.setSystemTime(new Date("2026-10-09T10:00:00Z")); // 8 days later: past SESSION_MS
  expect((await t.query(api.auth.me, { token: TOKEN })).admin).toBe(false);
  expect(await err(t.query(api.admin.stats, { token: TOKEN }))).toMatch(/sign in/);
  expect(await err(t.query(api.admin.auditLog, { token: TOKEN }))).toMatch(/sign in/);
});

test("every admin mutation refuses a bad token", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const venue = (await t.query(api.admin.venues, { token: TOKEN }))[0];
  const { code } = await t.mutation(api.public.createBooking, { name: "Victim", phone: "9000000009", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  const row = (await t.query(api.admin.listBookings, { token: TOKEN, q: code, paginationOpts: { numItems: 5, cursor: null } })).page[0];
  for (const bad of ["", "nope", "z".repeat(40)]) {
    expect(await err(t.mutation(api.admin.bookingAction, { token: bad, id: row.id, action: "confirm" }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.deleteBooking, { token: bad, id: row.id }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.updateBooking, { token: bad, id: row.id, name: "Mallory", phone: "9000000000" }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.setNote, { token: bad, id: row.id, note: "x" }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.saveSettings, { token: bad, values: { site_name: "Pwned" } }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.saveVenue, { token: bad, name: "Rogue", active: true, sort: 1 }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.deleteVenue, { token: bad, id: venue.id }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.savePass, { token: bad, venueId: venue.id, label: "Rogue", price: 1, quantity: 1, maxPerBooking: 1, admits: 1, active: true, sort: 1 }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.deletePass, { token: bad, id: p.id }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.bulkPasses, { token: bad, venueId: venue.id, from: "2026-10-11", to: "2026-10-12", label: "R", price: 1, quantity: 1, maxPerBooking: 1, admits: 1, active: true, sort: 1 }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.saveFaq, { token: bad, question: "q", answer: "a", sort: 1, active: true }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.loadSampleData, { token: bad }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.uploadUrl, { token: bad }))).toMatch(/sign in/);
    expect(await err(t.mutation(api.admin.counterBooking, { token: bad, name: "R", phone: "9000000000", items: [{ passId: p.id, qty: 1 }], secret: SECRET, status: "confirmed" }))).toMatch(/sign in/);
    expect(await err(t.query(api.admin.getBooking, { token: bad, id: row.id }))).toMatch(/sign in/);
    expect(await err(t.query(api.admin.exportPage, { token: bad, paginationOpts: { numItems: 5, cursor: null } }))).toMatch(/sign in/);
    expect(await err(t.query(api.admin.auditLog, { token: bad }))).toMatch(/sign in/);
  }
  // the booking is untouched
  expect(((await t.query(api.public.booking, { code, secret: SECRET })) as any).status).toBe("awaiting_payment");
});

test("a booking's secret guards every write path, not just reads", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const a = await t.mutation(api.public.createBooking, { name: "Owner", phone: "9000000010", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  const b = await t.mutation(api.public.createBooking, { name: "Other", phone: "9000000011", items: [{ passId: p.id, qty: 1 }], secret: "another-secret-0123456789" });
  const wrong = "wrong-secret-xxxxxxxxxxxx";
  expect(await t.query(api.public.booking, { code: a.code, secret: wrong })).toBeNull();
  expect(await t.query(api.public.booking, { code: a.code, secret: "" })).toBeNull();
  expect(await err(t.mutation(api.public.cancelBooking, { code: a.code, secret: wrong }))).toMatch(/not found/i);
  expect(await err(t.mutation(api.public.uploadUrl, { code: a.code, secret: wrong }))).toMatch(/not found/i);
  expect((await proof(t, a.code, "412345678902")).error).toBeNull(); // the real owner still works
  // one booking's secret must not open another's
  expect(await t.query(api.public.booking, { code: b.code, secret: SECRET })).toBeNull();
  expect(await err(t.mutation(api.public.cancelBooking, { code: b.code, secret: SECRET }))).toMatch(/not found/i);
  expect(((await t.query(api.public.booking, { code: b.code, secret: "another-secret-0123456789" })) as any).status).toBe("awaiting_payment");
});

test("status transitions outside the rules are refused", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Rules", phone: "9000000012", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  await proof(t, code, "412345678903");
  const row = (await t.query(api.admin.listBookings, { token: TOKEN, q: code, paginationOpts: { numItems: 5, cursor: null } })).page[0];
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "nonsense" }))).toMatch(/Unknown action/);
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "checkin" }))).toMatch(/Cannot checkin/);
  await t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "confirm" });
  // confirmed is terminal for these
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "reject" }))).toMatch(/Cannot reject/);
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "reupload" }))).toMatch(/Cannot reupload/);
  expect(await err(t.mutation(api.admin.bookingAction, { token: TOKEN, id: row.id, action: "reopen" }))).toMatch(/Cannot reopen/);
});

test("unpaid holds are capped per phone, per pass and event-wide", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const mk = (phone: string, qty = 1) =>
    t.mutation(api.public.createBooking, { name: "Flood", phone, items: [{ passId: p.id, qty }], secret: SECRET });
  await mk("9000000013"); await mk("9000000013"); await mk("9000000013");
  // 4th unpaid hold on the same number is refused — and phone formatting is not a way round it
  expect(await err(mk("+91 90000 00013"))).toMatch(/already have 3 unpaid/);
  expect(await err(mk("09000000013"))).toMatch(/already have 3 unpaid/);

  // unpaid holds may never cover more than a quarter of a pass's stock
  await t.mutation(api.admin.savePass, { token: TOKEN, id: p.id, venueId: (await t.query(api.admin.passes, { token: TOKEN })).find((x: any) => x.id === p.id)!.venueId, date: p.date, label: p.label, price: p.price, quantity: 40, maxPerBooking: 2, admits: 1, active: true, sort: 1 });
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) {
    try { await mk(`90000001${String(20 + i).padStart(2, "0")}`, 2); } catch { blocked = true; }
  }
  expect(blocked).toBe(true);
  const after: any = await t.run(async (ctx: any) => ctx.db.get(p.id));
  expect(after.unpaid).toBeLessThanOrEqual(Math.floor(40 * 0.25) + 2);
  // and the stock those holds don't cover is still sellable
  expect((await firstPass(t, (x: any) => x.id === p.id)).available).toBeGreaterThan(20);
});

test("looking up a booking's secret is rate limited", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Target", phone: "9000000014", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  // guessing the code against a known phone number runs out of attempts
  let msg = "";
  for (let i = 0; i < 15; i++) {
    try { await t.action(api.public.lookup, { code: `MVGUESS${i}`, phone: "9000000014" }); }
    catch (e: any) { msg = e.data?.message ?? e.message; }
  }
  expect(msg).toMatch(/Too many attempts/);
  // the real owner is locked out too, which is the cost of closing the oracle
  expect(await err(t.action(api.public.lookup, { code, phone: "9000000014" }))).toMatch(/Too many attempts/);
});

test("payment details need the password, not just a session", async () => {
  const t = await setup();
  // the ordinary settings mutation refuses them outright
  expect(await err(t.mutation(api.admin.saveSettings, { token: TOKEN, values: { upi_id: "attacker@okaxis" } }))).toMatch(/asks for your password/);
  expect((await t.query(api.public.config, {})).upi_id).toBe("mavladimandli@upi");
  // a session alone is not enough
  expect(await err(t.action(api.admin.savePaymentSettings, { token: TOKEN, password: "wrong-password", values: { upi_id: "attacker@okaxis" } }))).toMatch(/Password is wrong/);
  expect((await t.query(api.public.config, {})).upi_id).toBe("mavladimandli@upi");
  // with the password it works, is validated, and is recorded
  expect(await err(t.action(api.admin.savePaymentSettings, { token: TOKEN, password: PASSWORD, values: { upi_id: "not a upi" } }))).toMatch(/UPI ID/);
  await t.action(api.admin.savePaymentSettings, { token: TOKEN, password: PASSWORD, values: { upi_id: "mandli@okaxis" } });
  expect((await t.query(api.public.config, {})).upi_id).toBe("mandli@okaxis");
  const log = await t.query(api.admin.auditLog, { token: TOKEN });
  expect(log.find((r: any) => r.action === "settings.upi_id")).toMatchObject({ before: "mavladimandli@upi", after: "mandli@okaxis" });
});

test("settings that become links cannot carry a javascript: URL", async () => {
  const t = await setup();
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "JaVaScRiPt:alert(1)"]) {
    expect(await err(t.mutation(api.admin.saveSettings, { token: TOKEN, values: { instagram_url: bad } }))).toMatch(/must start with/);
    expect(await err(t.mutation(api.admin.saveSettings, { token: TOKEN, values: { youtube_url: bad } }))).toMatch(/must start with/);
  }
  await t.mutation(api.admin.saveSettings, { token: TOKEN, values: { instagram_url: "https://instagram.com/mavladi" } });
  expect((await t.query(api.public.config, {})).instagram_url).toBe("https://instagram.com/mavladi");
});

test("upload content type comes from the bytes, not the browser's claim", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Polyglot", phone: "9000000015", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  // real PNG magic bytes, an HTML payload after them, and a browser claiming text/html
  const polyglot = new Blob(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "<script>alert(document.domain)</script>"],
    { type: "text/html" },
  );
  expect((await proof(t, code, "412345678904", polyglot)).error).toBeNull();
  // it is stored as an image, so opening it cannot execute
  expect(await storedType(t, code)).toBe("image/png");
});

test("upload URLs are rate limited", async () => {
  const t = await setup();
  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Flooder", phone: "9000000016", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  let msg = "";
  for (let i = 0; i < 20; i++) {
    try { await t.mutation(api.public.uploadUrl, { code, secret: SECRET }); }
    catch (e: any) { msg = e.data?.message ?? e.message; }
  }
  expect(msg).toMatch(/Too many upload attempts/);
});

test("admin CRUD: venue, bulk nights, settings, lookup, delete keeps counters right", async () => {
  const t = await setup();
  const venueId = await t.mutation(api.admin.saveVenue, { token: TOKEN, name: "Test Ground", active: true, sort: 9 });
  expect(await t.mutation(api.admin.bulkPasses, { token: TOKEN, venueId, from: "2026-10-11", to: "2026-10-19", label: "Daily", price: 100, quantity: 50, maxPerBooking: 10, admits: 1, active: true, sort: 0 })).toBe(9);
  await t.action(api.admin.savePaymentSettings, { token: TOKEN, password: PASSWORD, values: { upi_id: "mandli@okaxis" } });
  const cfg = await t.query(api.public.config, {});
  expect(cfg.upi_id).toBe("mandli@okaxis");
  expect(Object.keys(cfg)).not.toContain("admin_password_hash");

  const p = await firstPass(t);
  const { code } = await t.mutation(api.public.createBooking, { name: "Look Up", phone: "9000000007", items: [{ passId: p.id, qty: 1 }], secret: SECRET });
  expect((await t.action(api.public.lookup, { code: code.toLowerCase(), phone: "919000000007" })).secret).toBe(SECRET);
  expect(await err(t.action(api.public.lookup, { code, phone: "9999999999" }))).toMatch(/No booking/);

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
