/* The admin panel's API. Every function takes the session token from auth.login. */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  allSettings, applyStatus, clean, EDITABLE_SETTINGS, fail, fmtDate, gateNight,
  normPhone, normUtr, requireAdmin, searchText, setSetting, todayIST, validEmail, validPhone, type Status,
} from "./lib";
import { bookingByCode, bookingInput, createBooking } from "./bookings";
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
  const venues = new Map((await ctx.db.query("venues").collect()).map((x) => [x._id, x]));
  const inventory = (await ctx.db.query("passes").collect())
    .map((p) => ({
      id: p._id, venue_id: p.venueId, venue: venues.get(p.venueId)?.name ?? "?", venue_sort: venues.get(p.venueId)?.sort ?? 0,
      date: p.date, label: p.label, price: p.price, quantity: p.quantity, held: p.held, confirmed: p.sold, active: p.active, sort: p.sort,
    }))
    .sort((a, b) => a.venue_sort - b.venue_sort || (a.date ?? "").localeCompare(b.date ?? "") || a.sort - b.sort);
  const night = gateNight();
  const checkins = (await ctx.db.query("checkins").withIndex("by_night", (q) => q.eq("night", night)).collect()).length;
  const pending = (await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "pending")).take(500))
    .sort((a, b) => (a.paidAt ?? 0) - (b.paidAt ?? 0))
    .slice(0, 8)
    .map((b) => ({ id: b._id, code: b.code, name: b.name, amount: b.amount, paid_at: b.paidAt ?? null }));
  return {
    byStatus: counters.map((c) => ({ status: c.status, n: c.n, amount: c.amount })),
    inventory, checkins_today: checkins, pending_queue: pending, today: todayIST(), night,
    empty: venues.size === 0,
  };
} });

/* ================= bookings ================= */
const row = (b: Doc<"bookings">) => ({
  id: b._id, code: b.code, name: b.name, phone: b.phone, email: b.email ?? null, amount: b.amount, status: b.status,
  utr: b.utr ?? null, screenshot: !!b.screenshotId, source: b.source, created_at: b._creationTime,
  paid_at: b.paidAt ?? null, verified_at: b.verifiedAt ?? null, checked_in_at: b.lastCheckinAt ?? null,
  expires_at: b.expiresAt ?? null, admin_note: b.adminNote ?? null,
  items: b.items.map((i) => ({ qty: i.qty, pass_label: i.passLabel, pass_date: i.passDate, venue_name: i.venueName, venue_id: i.venueId, unit_price: i.unitPrice, admits: i.admits })),
});

export const listBookings = adminQuery({ args: {
  status: v.optional(v.string()),
  venueId: v.optional(v.string()),
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
  const page = res.page.filter((b) =>
    (!a.venueId || b.items.some((i) => i.venueId === a.venueId)) &&
    (!a.date || b.items.some((i) => (a.date === "season" ? i.passDate === null : i.passDate === a.date))));
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
    const valid = b.items.some((i) => i.passDate === null || i.passDate === night);
    if (!valid && !force) fail(`This pass is for ${[...new Set(b.items.map((i) => fmtDate(i.passDate)))].join(", ")}, not tonight.`, "WRONG_NIGHT");
    await ctx.db.insert("checkins", { bookingId: id, night, at: now });
    await ctx.db.patch(id, { lastCheckinAt: now });
    return true;
  }

  const to = rule.to!;
  await applyStatus(ctx, b.items, b.amount, b.status, to); // checks stock when re-holding
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
  await ctx.db.patch(a.id, { ...next, searchText: searchText({ ...b, ...next }) });
  return true;
} });

export const setNote = adminMutation({ args: { id: v.id("bookings"), note: v.string() }, handler: async (ctx, { id, note }) => {
  await ctx.db.patch(id, { adminNote: clean(note, 500) || undefined });
} });

export const deleteBooking = adminMutation({ args: { id: v.id("bookings") }, handler: async (ctx, { id }) => {
  const b = await ctx.db.get(id);
  if (!b) return true;
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
  return { id: b._id, code: b.code };
} });

/* ================= venues ================= */
const venueArgs = {
  name: v.string(), nameGu: v.optional(v.string()), city: v.optional(v.string()), address: v.optional(v.string()),
  mapUrl: v.optional(v.string()), description: v.optional(v.string()), image: v.optional(v.string()),
  startTime: v.optional(v.string()), active: v.boolean(), sort: v.number(),
};
function venueDoc(a: any) {
  const o = {
    name: clean(a.name, 120), nameGu: clean(a.nameGu, 120) || undefined, city: clean(a.city, 80) || undefined,
    address: clean(a.address, 300) || undefined, mapUrl: clean(a.mapUrl, 500) || undefined,
    description: clean(a.description, 1000) || undefined, image: clean(a.image, 1000) || undefined,
    startTime: clean(a.startTime, 60) || undefined, active: a.active, sort: a.sort || 0,
  };
  if (o.name.length < 2) fail("Venue name is required.");
  if (o.mapUrl && !/^https?:\/\//i.test(o.mapUrl)) fail("Map link must start with http(s)://");
  if (o.image && !/^(https?:\/\/|\/)/i.test(o.image)) fail("Image must be an uploaded file or a full URL.");
  return o;
}
export const venues = adminQuery({ args: {}, handler: async (ctx) => {
  const passes = await ctx.db.query("passes").collect();
  return (await ctx.db.query("venues").collect()).sort((a, b) => a.sort - b.sort)
    .map((x) => ({ ...x, id: x._id, pass_count: passes.filter((p) => p.venueId === x._id).length }));
} });
export const saveVenue = adminMutation({ args: { id: v.optional(v.id("venues")), ...venueArgs }, handler: async (ctx, a) => {
  const doc = venueDoc(a);
  if (a.id) { await ctx.db.replace(a.id, doc); return a.id; }
  return ctx.db.insert("venues", doc);
} });
export const deleteVenue = adminMutation({ args: { id: v.id("venues") }, handler: async (ctx, { id }) => {
  const passes = await ctx.db.query("passes").withIndex("by_venue", (q) => q.eq("venueId", id)).collect();
  const held = passes.reduce((s, p) => s + p.held, 0);
  if (held) fail(`This venue has ${held} passes booked or held. Deactivate it instead, or cancel those bookings first.`);
  for (const p of passes) await ctx.db.delete(p._id);
  await ctx.db.delete(id);
} });

/* ================= passes ================= */
const passArgs = {
  venueId: v.id("venues"), date: v.optional(v.union(v.string(), v.null())), label: v.string(), description: v.optional(v.string()),
  price: v.number(), quantity: v.number(), maxPerBooking: v.number(), admits: v.number(), active: v.boolean(), sort: v.number(),
};
async function passDoc(ctx: QueryCtx, a: any) {
  const o = {
    venueId: a.venueId as Id<"venues">, date: a.date ? String(a.date).slice(0, 10) : null,
    label: clean(a.label, 80) || "Entry Pass", description: clean(a.description, 300) || undefined,
    price: Math.floor(a.price), quantity: Math.floor(a.quantity), maxPerBooking: Math.max(1, Math.floor(a.maxPerBooking) || 10),
    admits: Math.max(1, Math.floor(a.admits) || 1), active: a.active, sort: a.sort || 0,
  };
  if (!(await ctx.db.get(o.venueId))) fail("Pick a venue.");
  if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) fail("Date must be YYYY-MM-DD.");
  if (!Number.isFinite(o.price) || o.price < 0) fail("Price must be 0 or more.");
  if (!Number.isFinite(o.quantity) || o.quantity < 0) fail("Quantity must be 0 or more.");
  return o;
}
export const passes = adminQuery({ args: { venueId: v.optional(v.id("venues")) }, handler: async (ctx, { venueId }) => {
  const venues = new Map((await ctx.db.query("venues").collect()).map((x) => [x._id, x]));
  const rows = venueId
    ? await ctx.db.query("passes").withIndex("by_venue", (q) => q.eq("venueId", venueId)).collect()
    : await ctx.db.query("passes").collect();
  return rows
    .map((p) => ({ ...p, id: p._id, venue_name: venues.get(p.venueId)?.name ?? "?", venue_sort: venues.get(p.venueId)?.sort ?? 0 }))
    .sort((a, b) => a.venue_sort - b.venue_sort || (a.date === null ? -1 : 0) - (b.date === null ? -1 : 0) || (a.date ?? "").localeCompare(b.date ?? "") || a.sort - b.sort);
} });
export const savePass = adminMutation({ args: { id: v.optional(v.id("passes")), ...passArgs }, handler: async (ctx, a) => {
  const doc = await passDoc(ctx, a);
  if (a.id) {
    const cur = await ctx.db.get(a.id);
    if (!cur) fail("Pass not found.");
    if (doc.quantity < cur!.held) fail(`${cur!.held} of these are already booked or held — quantity can't go below that.`);
    await ctx.db.patch(a.id, doc);
    return a.id;
  }
  return ctx.db.insert("passes", { ...doc, held: 0, sold: 0 });
} });
export const bulkPasses = adminMutation({ args: { from: v.string(), to: v.string(), ...passArgs }, handler: async (ctx, a) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.from) || !/^\d{4}-\d{2}-\d{2}$/.test(a.to) || a.to < a.from) fail("Pick a valid date range.");
  const base = await passDoc(ctx, { ...a, date: a.from });
  let n = 0;
  for (let d = new Date(a.from + "T00:00:00Z"); d <= new Date(a.to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    if (++n > 60) fail("That range is longer than 60 nights.");
    await ctx.db.insert("passes", { ...base, date: d.toISOString().slice(0, 10), held: 0, sold: 0 });
  }
  return n;
} });
export const deletePass = adminMutation({ args: { id: v.id("passes") }, handler: async (ctx, { id }) => {
  const p = await ctx.db.get(id);
  if (p && p.held) fail(`${p.held} of these are booked or held. Take it off sale instead.`);
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
export const saveSettings = adminMutation({ args: { values: v.record(v.string(), v.string()) }, handler: async (ctx, { values }) => {
  if (values.upi_id !== undefined && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(values.upi_id.trim())) fail("UPI ID should look like name@bank.");
  if (values.hold_minutes !== undefined) {
    const m = parseInt(values.hold_minutes, 10);
    if (!(m >= 5 && m <= 1440)) fail("Payment window must be between 5 and 1440 minutes.");
  }
  for (const k of EDITABLE_SETTINGS) if (values[k] !== undefined) await setSetting(ctx, k, values[k].trim().slice(0, 4000));
} });
export const uploadUrl = adminMutation({ args: {}, handler: async (ctx) => ctx.storage.generateUploadUrl() });
export const fileUrl = adminMutation({ args: { storageId: v.id("_storage") }, handler: async (ctx, { storageId }) => {
  // admin-only; the browser already restricts the picker to images
  const url = await ctx.storage.getUrl(storageId);
  if (!url) fail("Upload failed. Please try again.");
  return url;
} });

export const loadSampleData = adminMutation({ args: {}, handler: async (ctx) => {
  if ((await ctx.db.query("venues").first())) fail("There is already data. Sample data is only for an empty database.");
  await seedData(ctx);
} });

