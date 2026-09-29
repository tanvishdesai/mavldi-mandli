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
export function fmtDate(iso: string | null) {
  if (!iso) return "Season";
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
export const searchText = (b: { code: string; name: string; phone: string; utr?: string; email?: string }) =>
  [b.code, b.name, b.phone, b.utr, b.email].filter(Boolean).join(" ").toLowerCase();

/* ---------- settings ---------- */
export const DEFAULT_SETTINGS: Record<string, string> = {
  site_name: "Mavladi Mandli",
  site_name_gu: "માવલડી મંડળી",
  tagline: "The Reality of Culture",
  tagline_gu: "મા ના આંગણે રંગોત્સવ",
  event_title: "Navratri 2026",
  event_dates_text: "11th – 19th October, 2026",
  event_time_text: "8:30 pm onwards",
  upi_id: "mavladimandli@upi",
  upi_payee_name: "Mavladi Mandli",
  upi_qr_image: "",
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
    "Mavladi is a sheri-style garba raised in the courtyard of the Mother. Nine nights of dhol, diya and devotion — where the old circles are danced the old way, and every family finds its place in the ring.",
  terms_text:
    "Passes are non-transferable and non-refundable once confirmed. Traditional attire is mandatory. Entry is subject to security checks. The management reserves the right of admission.",
};
export const PUBLIC_SETTINGS = Object.keys(DEFAULT_SETTINGS);
export const EDITABLE_SETTINGS = PUBLIC_SETTINGS;

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
    const what = `${it.passLabel}${it.passDate ? " · " + fmtDate(it.passDate) : ""}`;
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
    let held = p.held, sold = p.sold;
    if (wasHeld && !nowHeld) held -= it.qty;
    if (!wasHeld && nowHeld) held += it.qty;
    if (from === "confirmed") sold -= it.qty;
    if (to === "confirmed") sold += it.qty;
    await ctx.db.patch(p._id, { held: Math.max(0, held), sold: Math.max(0, sold) });
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
