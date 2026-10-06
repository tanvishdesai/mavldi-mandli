/* The admin panel's API. Every function takes the session token from auth.login. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { action, internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  allSettings, applyStatus, audit, clean, EDITABLE_SETTINGS, fail, fmtDate, gateNight, getSetting,
  normPhone, normUtr, PAYMENT_SETTINGS, requireAdmin, searchText, setSetting, todayIST,
  URL_SETTINGS, validEmail, validUrl, validPhone, type Status,
} from "./lib";
import { bookingByCode, bookingInput, createBooking, utrOwner } from "./bookings";
import { seedData } from "./seed";

/* Every admin function takes the session token and is refused without a live session. */
const adminQuery = customQuery(query, {
  args: { token: v.string() },
  input: async (ctx, { token }) => { await requireAdmin(ctx, token); return { ctx: {}, args: {} }; },
});
const adminMutation = customMutation(mutation, {
  args: { token: v.string() },
  input: async (ctx, { token }) => { await requireAdmin(ctx, token); return { ctx: {}, args: {} }; },
});

/* ================= dashboard ================= */
export const stats = adminQuery({ args: {}, handler: async (ctx) => {
  const counters = await ctx.db.query("counters").collect();
  const price = Math.max(0, Math.floor(parseFloat(await getSetting(ctx, "pass_price")) || 0));
  const inventory = (await ctx.db.query("passes").withIndex("by_date").collect())
    .map((p) => ({
      id: p._id, date: p.date, price, quantity: p.quantity,
      held: p.held, unpaid: p.unpaid, confirmed: p.sold, active: p.active,
    }));
  const night = gateNight();
  const checkins = (await ctx.db.query("checkins").withIndex("by_night", (q) => q.eq("night", night)).collect()).length;
  const pending = (await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "pending")).take(500))
    .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0))
    .slice(0, 8)
    .map((b) => ({ id: b._id, code: b.code, name: b.name, amount: b.amount, paid_at: b.paidAt ?? null }));
  return {
    byStatus: counters.map((c) => ({ status: c.status, n: c.n, amount: c.amount })),
    inventory, checkins_today: checkins, pending_queue: pending, today: todayIST(), night,
    price, empty: inventory.length === 0,
  };
} });

/* ================= bookings ================= */
const row = (b: Doc<"bookings">) => ({
  id: b._id, code: b.code, name: b.name, phone: b.phone, email: b.email ?? null, amount: b.amount, status: b.status,
  utr: b.utr ?? null, screenshot: !!b.screenshotId, source: b.source, created_at: b._creationTime,
  paid_at: b.paidAt ?? null, verified_at: b.verifiedAt ?? null, checked_in_at: b.lastCheckinAt ?? null,
  expires_at: b.expiresAt ?? null, admin_note: b.adminNote ?? null,
  items: b.items.map((i) => ({ qty: i.qty, date: i.date, unit_price: i.unitPrice })),
});

export const listBookings = adminQuery({ args: {
  status: v.optional(v.string()),
  date: v.optional(v.string()),
  q: v.optional(v.string()),
  paginationOpts: paginationOptsValidator,
}, handler: async (ctx, a) => {
  const status = a.status as Status | undefined;
  let res;
  const term = (a.q ?? "").trim().toLowerCase();
  if (term) {
    res = await ctx.db.query("bookings")
      .withSearchIndex("search", (q) => (status ? q.search("searchText", term).eq("status", status) : q.search("searchText", term)))
      .paginate(a.paginationOpts);
  } else if (status) {
    res = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", status)).order(status === "pending" ? "asc" : "desc").paginate(a.paginationOpts);
  } else {
    res = await ctx.db.query("bookings").order("desc").paginate(a.paginationOpts);
  }
  const page = res.page.filter((b) => !a.date || b.items.some((i) => i.date === a.date));
  return { ...res, page: page.map(row) };
} });

/* for CSV export: walk every booking a page at a time */
export const exportPage = adminQuery({ args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, a) => {
  const res = await ctx.db.query("bookings").order("asc").paginate(a.paginationOpts);
  return { ...res, page: res.page.map((b) => ({ ...row(b), customer_note: b.customerNote ?? null })) };
} });

export const getBooking = adminQuery({ args: { id: v.id("bookings") }, handler: async (ctx, { id }) => {
  const b = await ctx.db.get(id);
  if (!b) return null;
  const dup = b.utr ? (await ctx.db.query("bookings").withIndex("by_utr", (q) => q.eq("utr", b.utr)).collect()).filter((x) => x._id !== b._id) : [];
  const same = (await ctx.db.query("bookings").withIndex("by_phone", (q) => q.eq("phone", b.phone)).collect()).filter((x) => x._id !== b._id);
  const checkins = await ctx.db.query("checkins").withIndex("by_booking", (q) => q.eq("bookingId", b._id)).collect();
  return {
    ...row(b),
    secret: b.secret,
    customer_note: b.customerNote ?? null,
    screenshot_url: b.screenshotId ? await ctx.storage.getUrl(b.screenshotId) : null,
    duplicate_utr: dup.map((d) => ({ id: d._id, code: d.code, name: d.name, status: d.status })),
    same_phone: same.slice(0, 10).map((d) => ({ id: d._id, code: d.code, status: d.status, amount: d.amount })),
    checkins: checkins.map((c) => ({ night: c.night, at: c.at })),
    night: gateNight(),
  };
} });

export const checkinLookup = adminQuery({ args: { code: v.string() }, handler: async (ctx, { code }) => {
  const b = await bookingByCode(ctx, code);
  if (!b) return null;
  const checkins = await ctx.db.query("checkins").withIndex("by_booking", (q) => q.eq("bookingId", b._id)).collect();
  return { ...row(b), checkins: checkins.map((c) => ({ night: c.night, at: c.at })), night: gateNight() };
} });

const RULES: Record<string, { from: Status[]; to?: Status }> = {
  confirm: { from: ["pending", "awaiting_payment", "expired", "rejected", "cancelled"], to: "confirmed" },
  reject: { from: ["pending", "awaiting_payment"], to: "rejected" },
  reupload: { from: ["pending", "rejected", "expired"], to: "awaiting_payment" },
  cancel: { from: ["awaiting_payment", "pending", "confirmed"], to: "cancelled" },
  reopen: { from: ["rejected", "expired", "cancelled"], to: "pending" },
  checkin: { from: ["confirmed"] },
  undo_checkin: { from: ["confirmed"] },
};

export const bookingAction = adminMutation({ args: {
  id: v.id("bookings"), action: v.string(), note: v.optional(v.string()), force: v.optional(v.boolean()),
}, handler: async (ctx, { id, action, note, force }) => {
  const rule = RULES[action];
  if (!rule) fail("Unknown action.");
  const b = await ctx.db.get(id);
  if (!b) return fail("Booking not found.", "NOT_FOUND");
  if (!rule.from.includes(b.status)) fail(`Cannot ${action.replace("_", " ")} a booking that is ${b.status.replace("_", " ")}.`);
  const now = Date.now();
  const n = clean(note, 500);

  if (action === "checkin" || action === "undo_checkin") {
    const night = gateNight();
    const done = await ctx.db.query("checkins").withIndex("by_booking", (q) => q.eq("bookingId", id).eq("night", night)).unique();
    if (action === "undo_checkin") {
      if (done) await ctx.db.delete(done._id);
      const rest = await ctx.db.query("checkins").withIndex("by_booking", (q) => q.eq("bookingId", id)).collect();
      await ctx.db.patch(id, { lastCheckinAt: rest.length ? Math.max(...rest.map((r) => r.at)) : undefined });
      return true;
    }
    if (done) fail(`Already checked in tonight.`, "ALREADY");
    const valid = b.items.some((i) => i.date === night);
    if (!valid && !force) fail(`This pass is for ${[...new Set(b.items.map((i) => fmtDate(i.date)))].join(", ")}, not tonight.`, "WRONG_NIGHT");
    await ctx.db.insert("checkins", { bookingId: id, night, at: now });
    await ctx.db.patch(id, { lastCheckinAt: now });
    return true;
  }

  const to = rule.to!;
  /* Confirming is the moment a pass becomes real, so the duplicate-UTR warning in
     the drawer is not enough on its own — refuse unless the admin explicitly
     overrides after looking at both bookings. */
  if (to === "confirmed" && b.utr) {
    const clash = await utrOwner(ctx, b.utr, b._id);
    if (clash && !force) {
      fail(
        `UTR ${b.utr} is already on booking ${clash.code} (${clash.status.replace("_", " ")}). ` +
          "Check your bank statement: one transaction can only pay for one booking.",
        "DUPLICATE_UTR",
      );
    }
    if (clash) await audit(ctx, "booking.confirm_duplicate_utr", { subject: b.code, before: clash.code, note: n || undefined });
  }
  await applyStatus(ctx, b.items, b.amount, b.status, to); // checks stock when re-holding
  await audit(ctx, `booking.${action}`, { subject: b.code, before: b.status, after: to, note: n || undefined });
  const patch: Partial<Doc<"bookings">> = { status: to };
  if (n || ["reject", "reupload", "cancel"].includes(action)) patch.adminNote = n || undefined;
  if (to === "confirmed") patch.verifiedAt = now;
  if (to === "awaiting_payment") {
    patch.expiresAt = now + 24 * 3600_000;
    await ctx.scheduler.runAt(patch.expiresAt, internal.bookings.expire, { id });
  } else patch.expiresAt = undefined;
  await ctx.db.patch(id, patch);
  return true;
} });

export const updateBooking = adminMutation({ args: {
  id: v.id("bookings"), name: v.string(), phone: v.string(), email: v.optional(v.string()), utr: v.optional(v.string()), admin_note: v.optional(v.string()),
}, handler: async (ctx, a) => {
  const b = await ctx.db.get(a.id);
  if (!b) return fail("Booking not found.");
  const next = {
    name: clean(a.name, 80), phone: normPhone(a.phone),
    email: clean(a.email, 120).toLowerCase() || undefined,
    utr: a.utr !== undefined ? normUtr(a.utr) || undefined : b.utr,
    adminNote: a.admin_note !== undefined ? clean(a.admin_note, 500) || undefined : b.adminNote,
  };
  if (next.name.length < 2) fail("Name is too short.");
  if (!validPhone(next.phone)) fail("Invalid phone number.");
  if (next.email && !validEmail(next.email)) fail("Invalid email.");
  // editing a UTR must not be a way around the one-payment-one-booking rule
  if (next.utr && next.utr !== b.utr) {
    const clash = await utrOwner(ctx, next.utr, b._id);
    if (clash) fail(`UTR ${next.utr} is already on booking ${clash.code}.`, "DUPLICATE_UTR");
  }
  await ctx.db.patch(a.id, { ...next, searchText: searchText({ ...b, ...next }) });
  if (next.utr !== b.utr) await audit(ctx, "booking.utr_edit", { subject: b.code, before: b.utr, after: next.utr });
  return true;
} });

export const setNote = adminMutation({ args: { id: v.id("bookings"), note: v.string() }, handler: async (ctx, { id, note }) => {
  await ctx.db.patch(id, { adminNote: clean(note, 500) || undefined });
} });

export const deleteBooking = adminMutation({ args: { id: v.id("bookings") }, handler: async (ctx, { id }) => {
  const b = await ctx.db.get(id);
  if (!b) return true;
  await audit(ctx, "booking.delete", { subject: b.code, before: b.status, note: `${b.amount} / ${b.utr ?? "no utr"}` });
  await applyStatus(ctx, b.items, b.amount, b.status, null);
  for (const c of await ctx.db.query("checkins").withIndex("by_booking", (q) => q.eq("bookingId", id)).collect()) await ctx.db.delete(c._id);
  if (b.screenshotId) await ctx.storage.delete(b.screenshotId);
  await ctx.db.delete(id);
  return true;
} });

export const counterBooking = adminMutation({ args: {
  ...bookingInput, secret: v.string(), status: v.string(), utr: v.optional(v.string()),
}, handler: async (ctx, a) => {
  const status = (["confirmed", "pending"].includes(a.status) ? a.status : "confirmed") as Status;
  const b = await createBooking(ctx, a, { admin: true, status, source: "counter", secret: a.secret, utr: a.utr });
  await audit(ctx, "booking.counter", { subject: b.code, after: status, note: String(b.amount) });
  return { id: b._id, code: b.code };
} });

/* ================= nights (stock per date) ================= */
const nightArgs = { date: v.string(), quantity: v.number(), active: v.boolean() };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function nightDoc(a: { date: string; quantity: number; active: boolean }) {
  const date = String(a.date).slice(0, 10);
  if (!ISO.test(date)) fail("Date must be YYYY-MM-DD.");
  const quantity = Math.floor(a.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) fail("Quantity must be 0 or more.");
  return { date, quantity, active: a.active };
}

export const passes = adminQuery({ args: {}, handler: async (ctx) =>
  (await ctx.db.query("passes").withIndex("by_date").collect())
    .map((p) => ({ id: p._id, date: p.date, quantity: p.quantity, held: p.held, unpaid: p.unpaid, sold: p.sold, active: p.active })) });

export const savePass = adminMutation({ args: { id: v.optional(v.id("passes")), ...nightArgs }, handler: async (ctx, a) => {
  const doc = nightDoc(a);
  if (a.id) {
    const cur = await ctx.db.get(a.id);
    if (!cur) fail("That night no longer exists.");
    if (doc.quantity < cur!.held) fail(`${cur!.held} passes for this night are already booked or held — quantity can't go below that.`);
    if (doc.date !== cur!.date && (await nightByDate(ctx, doc.date))) fail(`${fmtDate(doc.date)} is already in the list.`);
    await ctx.db.patch(a.id, doc);
    return a.id;
  }
  if (await nightByDate(ctx, doc.date)) fail(`${fmtDate(doc.date)} is already in the list.`);
  return ctx.db.insert("passes", { ...doc, held: 0, sold: 0, unpaid: 0 });
} });

const nightByDate = (ctx: QueryCtx, date: string) =>
  ctx.db.query("passes").withIndex("by_date", (q) => q.eq("date", date)).unique();

/* Add every night of the event in one go. Dates that already exist are left alone. */
export const bulkPasses = adminMutation({ args: { from: v.string(), to: v.string(), quantity: v.number(), active: v.boolean() }, handler: async (ctx, a) => {
  if (!ISO.test(a.from) || !ISO.test(a.to) || a.to < a.from) fail("Pick a valid date range.");
  const base = nightDoc({ ...a, date: a.from });
  let n = 0, made = 0;
  for (let d = new Date(a.from + "T00:00:00Z"); d <= new Date(a.to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    if (++n > 60) fail("That range is longer than 60 nights.");
    const date = d.toISOString().slice(0, 10);
    if (await nightByDate(ctx, date)) continue;
    await ctx.db.insert("passes", { ...base, date, held: 0, sold: 0, unpaid: 0 });
    made++;
  }
  return made;
} });

export const deletePass = adminMutation({ args: { id: v.id("passes") }, handler: async (ctx, { id }) => {
  const p = await ctx.db.get(id);
  if (p && p.held) fail(`${p.held} passes for this night are booked or held. Take it off sale instead.`);
  if (p) await ctx.db.delete(id);
} });

/* ================= faqs ================= */
export const faqs = adminQuery({ args: {}, handler: async (ctx) =>
  (await ctx.db.query("faqs").collect()).sort((a, b) => a.sort - b.sort).map((f) => ({ ...f, id: f._id })) });
export const saveFaq = adminMutation({ args: {
  id: v.optional(v.id("faqs")), question: v.string(), answer: v.string(), sort: v.number(), active: v.boolean(),
}, handler: async (ctx, a) => {
  const doc = { question: clean(a.question, 300), answer: String(a.answer).trim().slice(0, 2000), sort: a.sort || 0, active: a.active };
  if (!doc.question || !doc.answer) fail("Question and answer are both required.");
  if (a.id) await ctx.db.replace(a.id, doc); else await ctx.db.insert("faqs", doc);
} });
export const deleteFaq = adminMutation({ args: { id: v.id("faqs") }, handler: async (ctx, { id }) => { await ctx.db.delete(id); } });

/* ================= settings & files ================= */
export const settings = adminQuery({ args: {}, handler: async (ctx) => {
  const s = await allSettings(ctx);
  return Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, s[k]]));
} });
/* Shared validation for both settings paths. */
function checkSettings(values: Record<string, string>) {
  if (values.pass_price !== undefined) {
    const n = parseFloat(values.pass_price);
    if (!(n >= 0 && n <= 100000)) fail("Pass price must be a number between 0 and 100000.");
  }
  if (values.upi_id !== undefined && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(values.upi_id.trim())) fail("UPI ID should look like name@bank.");
  if (values.hold_minutes !== undefined) {
    const m = parseInt(values.hold_minutes, 10);
    if (!(m >= 5 && m <= 1440)) fail("Payment window must be between 5 and 1440 minutes.");
  }
  // these land in an href/src on a public page: no javascript: or data: URLs
  for (const k of URL_SETTINGS) {
    const val = values[k]?.trim();
    if (val && !validUrl(val)) fail(`${k.replace(/_/g, " ")} must start with http://, https:// or /.`);
  }
}

export const saveSettings = adminMutation({ args: { values: v.record(v.string(), v.string()) }, handler: async (ctx, { values }) => {
  const blocked = PAYMENT_SETTINGS.filter((k) => values[k] !== undefined);
  if (blocked.length) {
    fail("Payment details are changed under Settings → Payment, which asks for your password.", "NEEDS_PASSWORD");
  }
  checkSettings(values);
  for (const k of EDITABLE_SETTINGS) if (values[k] !== undefined) await setSetting(ctx, k, values[k].trim().slice(0, 4000));
} });

/* Where the money goes. A stolen session token is not enough: the password has
   to be re-entered, and every change is written to the audit log with its old
   value, so a silent redirect of all future payments is neither possible nor
   invisible. */
export const _savePaymentSettings = internalMutation({
  args: { values: v.record(v.string(), v.string()) },
  handler: async (ctx, { values }) => {
    checkSettings(values);
    const before = await allSettings(ctx);
    for (const k of PAYMENT_SETTINGS) {
      if (values[k] === undefined) continue;
      const next = values[k].trim().slice(0, 4000);
      if (next === before[k]) continue;
      await setSetting(ctx, k, next);
      await audit(ctx, `settings.${k}`, { subject: k, before: before[k], after: next });
    }
  },
});

export const savePaymentSettings = action({
  args: { token: v.string(), password: v.string(), values: v.record(v.string(), v.string()) },
  handler: async (ctx, { token, password, values }): Promise<true> => {
    await ctx.runAction(internal.auth.requirePassword, { token, password });
    await ctx.runMutation(internal.admin._savePaymentSettings, { values });
    return true;
  },
});

export const paymentSettings = adminQuery({ args: {}, handler: async (ctx) => {
  const s = await allSettings(ctx);
  return Object.fromEntries(PAYMENT_SETTINGS.map((k) => [k, s[k]]));
} });

/* Recent money-moving changes, newest first. */
export const auditLog = adminQuery({ args: {}, handler: async (ctx) =>
  (await ctx.db.query("auditLog").withIndex("by_at").order("desc").take(200))
    .map((r) => ({ id: r._id, at: r.at, action: r.action, subject: r.subject ?? null, before: r.before ?? null, after: r.after ?? null, note: r.note ?? null })) });
export const uploadUrl = adminMutation({ args: {}, handler: async (ctx) => ctx.storage.generateUploadUrl() });
export const fileUrl = adminMutation({ args: { storageId: v.id("_storage") }, handler: async (ctx, { storageId }) => {
  // admin-only; the browser already restricts the picker to images
  const url = await ctx.storage.getUrl(storageId);
  if (!url) fail("Upload failed. Please try again.");
  return url;
} });

export const loadSampleData = adminMutation({ args: {}, handler: async (ctx) => {
  if ((await ctx.db.query("passes").first())) fail("There is already data. Sample data is only for an empty database.");
  await seedData(ctx);
} });

