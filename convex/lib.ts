import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/* Errors the guest or admin should read. Anything else surfaces as a generic failure. */
export const fail = (message: string, code = "BAD_REQUEST"): never => {
  throw new ConvexError({ message, code });
};

export type Status = Doc<"bookings">["status"];
export const HOLDING: Status[] = ["awaiting_payment", "pending", "confirmed"];
export const isHolding = (s: Status | null) => s !== null && HOLDING.includes(s);

/* ---------- dates: stored as YYYY-MM-DD, always an evening in India ---------- */
const IST = 5.5 * 3600_000;
export const todayIST = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10);
/* Garba runs past midnight: until 6 am the gate still counts as the previous night. */
export const gateNight = (now = Date.now()) => new Date(now + IST - 6 * 3600_000).toISOString().slice(0, 10);
export function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd}, ${d.getUTCDate()} ${m}`;
}

/* ---------- validation ---------- */
export const clean = (v: unknown, max = 200) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
export function normPhone(v: unknown) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
export const validPhone = (d: string) => /^[6-9]\d{9}$/.test(d);
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const normUtr = (v: unknown) => String(v ?? "").replace(/[\s-]/g, "").toUpperCase();
/* Settings that end up in an href/src on a public page: no javascript:/data: */
export const validUrl = (u: string) => /^(https?:\/\/|\/)/i.test(u);
export const searchText = (b: { code: string; name: string; phone: string; utr?: string; email?: string }) =>
  [b.code, b.name, b.phone, b.utr, b.email].filter(Boolean).join(" ").toLowerCase();

/* ---------- settings ---------- */
export const DEFAULT_SETTINGS: Record<string, string> = {
  site_name: "Mavladi Mandli",
  site_name_gu: "માવલડી મંડળી",
  tagline: "The Reality of Culture",
  tagline_gu: "મા ના આંગણે રંગોત્સવ",
  event_title: "Navratri 2026",
  event_dates_text: "11th – 20th October, 2026",
  event_time_text: "9:00 pm – 4:00 am",
  pass_price: "599",
  venue_address: "Mavaldi Mandli Ground, beside Funblast, Nikol–Hanspura Road, Naroda, Ahmedabad 382330",
  venue_map_url: "https://maps.app.goo.gl/BweumSShRonT4cou9",
  venue_photo: "",
  upi_id: "mavladimandli@upi",
  upi_payee_name: "Mavladi Mandli",
  payment_instructions:
    "Pay the exact amount using any UPI app (GPay, PhonePe, Paytm, BHIM). Take a screenshot of the success screen that shows the UTR / transaction ID, then upload it below.",
  hold_minutes: "30",
  booking_open: "1",
  max_items_per_booking: "20",
  contact_phone: "",
  contact_whatsapp: "",
  contact_email: "",
  instagram_url: "",
  youtube_url: "",
  about_text:
    "Mavladi is a sheri-style garba raised in the courtyard of the Mother. Ten nights of dhol, diya and devotion — where the old circles are danced the old way, and every family finds its place in the ring. One ground, one circle, one pass.",
  terms_text:
    "One pass admits one person for the night it is booked for. Passes are non-transferable and non-refundable once confirmed. Traditional attire is mandatory. Entry is subject to security checks. The management reserves the right of admission.",
};
export const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);
/* Where the money goes. Changing any of these silently redirects every future
   payment, so they need the password re-entered (admin.savePaymentSettings)
   and are refused by the ordinary settings mutation. */
export const PAYMENT_SETTINGS = ["upi_id", "upi_payee_name"];
export const EDITABLE_SETTINGS = PUBLIC_SETTINGS.filter((k) => !PAYMENT_SETTINGS.includes(k));
/* Settings rendered into an href/src attribute by the frontend. */
export const URL_SETTINGS = ["instagram_url", "youtube_url", "venue_map_url", "venue_photo"];

export async function getSetting(ctx: QueryCtx, key: string) {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return row ? row.value : DEFAULT_SETTINGS[key] ?? "";
}
export async function allSettings(ctx: QueryCtx) {
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of await ctx.db.query("settings").collect()) out[r.key] = r.value;
  return out;
}
export async function setSetting(ctx: MutationCtx, key: string, value: string) {
  const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("settings", { key, value });
}

/* ---------- admin sessions ---------- */
export async function requireAdmin(ctx: QueryCtx, token: string) {
  const s = token ? await ctx.db.query("sessions").withIndex("by_token", (q) => q.eq("token", token)).unique() : null;
  if (!s || s.expiresAt < Date.now()) fail("Please sign in again.", "UNAUTHENTICATED");
}

/* ---------- rate limiting ----------
   One `attempts` row per bucket key. Keys are always sharded by phone / code /
   booking so no single row becomes a write hotspot under load; expired rows are
   cleared by the sweep cron. Convex gives us no client IP in a mutation, so the
   buckets key on the identifiers an attacker has to supply.
   ponytail: per-identifier buckets, move to per-IP via an httpAction if someone
   starts rotating phone numbers faster than this bounds them. */
export async function rateLimit(ctx: MutationCtx, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const row = await ctx.db.query("attempts").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (!row || row.resetAt < now) {
    if (row) await ctx.db.patch(row._id, { count: 1, resetAt: now + windowMs });
    else await ctx.db.insert("attempts", { key, count: 1, resetAt: now + windowMs });
    return true;
  }
  await ctx.db.patch(row._id, { count: row.count + 1 });
  return row.count < max;
}
/** Rate limit or refuse with a message the guest can read. */
export async function limit(ctx: MutationCtx, key: string, max: number, windowMs: number, msg: string) {
  if (!(await rateLimit(ctx, key, max, windowMs))) fail(msg, "RATE_LIMIT");
}

/* Bounds on abuse that no legitimate guest comes near. */
export const LIMITS = {
  bookingsPerPhone: { max: 6, windowMs: 30 * 60_000 },
  lookupPerPhone: { max: 10, windowMs: 15 * 60_000 },
  lookupPerCode: { max: 10, windowMs: 15 * 60_000 },
  uploadPerBooking: { max: 12, windowMs: 60 * 60_000 },
  /* Unpaid holds may never sit on more than this share of a night's stock, so a
     flood of fake holds can delay at most a quarter of the event's sales. */
  unpaidShareOfStock: 0.25,
  /* Hard ceiling on simultaneous unpaid holds across the whole event. */
  maxOpenHolds: 1000,
};

/* ---------- audit log ---------- */
export async function audit(
  ctx: MutationCtx,
  action: string,
  d: { subject?: string; before?: string; after?: string; note?: string } = {},
) {
  await ctx.db.insert("auditLog", { at: Date.now(), action, ...d });
}

/** Constant-time string compare, for anything an attacker can guess byte by byte. */
export function timingSafeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- status changes keep every counter honest ---------- */
async function bumpCounter(ctx: MutationCtx, status: string, dn: number, damount: number) {
  const row = await ctx.db.query("counters").withIndex("by_status", (q) => q.eq("status", status)).unique();
  if (row) await ctx.db.patch(row._id, { n: row.n + dn, amount: row.amount + damount });
  else await ctx.db.insert("counters", { status, n: dn, amount: damount });
}

/** Describes the first item that can't be (re)reserved, or null if all fit. */
export async function shortfall(ctx: QueryCtx, items: Doc<"bookings">["items"]) {
  const need = new Map<Id<"passes">, number>();
  for (const it of items) need.set(it.passId, (need.get(it.passId) || 0) + it.qty);
  for (const [id, qty] of need) {
    const p = await ctx.db.get(id);
    const it = items.find((i) => i.passId === id)!;
    const what = fmtDate(it.date);
    if (!p) return what;
    if (qty > p.quantity - p.held) return what;
  }
  return null;
}

/**
 * Move a booking between statuses (or in/out of existence with null),
 * adjusting pass held/sold counters and the dashboard totals in the same transaction.
 */
export async function applyStatus(
  ctx: MutationCtx,
  items: Doc<"bookings">["items"],
  amount: number,
  from: Status | null,
  to: Status | null,
  opts: { checkStock?: boolean } = {},
) {
  if (from === to) return;
  const wasHeld = isHolding(from), nowHeld = isHolding(to);
  if (!wasHeld && nowHeld && opts.checkStock !== false) {
    const short = await shortfall(ctx, items);
    if (short) fail(`Not enough passes left for ${short}.`, "SOLD_OUT");
  }
  for (const it of items) {
    const p = await ctx.db.get(it.passId);
    if (!p) continue;
    let held = p.held, sold = p.sold, unpaid = p.unpaid;
    if (wasHeld && !nowHeld) held -= it.qty;
    if (!wasHeld && nowHeld) held += it.qty;
    if (from === "confirmed") sold -= it.qty;
    if (to === "confirmed") sold += it.qty;
    if (from === "awaiting_payment") unpaid -= it.qty;
    if (to === "awaiting_payment") unpaid += it.qty;
    await ctx.db.patch(p._id, {
      held: Math.max(0, held), sold: Math.max(0, sold), unpaid: Math.max(0, unpaid),
    });
  }
  if (from) await bumpCounter(ctx, from, -1, -amount);
  if (to) await bumpCounter(ctx, to, 1, amount);
}

export function upiUri(upiId: string, payee: string, amount: number, code: string) {
  const q = [
    ["pa", upiId], ["pn", payee], ["am", amount.toFixed(2)], ["cu", "INR"], ["tn", `Mavladi ${code}`],
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `upi://pay?${q}`;
}
