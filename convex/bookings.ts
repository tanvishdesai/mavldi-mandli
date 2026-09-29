import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  applyStatus, clean, fail, getSetting, normPhone, normUtr, searchText,
  todayIST, validEmail, validPhone, fmtDate, shortfall, type Status,
} from "./lib";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  let s = "MV";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export const bookingInput = {
  name: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  note: v.optional(v.string()),
  items: v.array(v.object({ passId: v.id("passes"), qty: v.number() })),
};

type CreateOpts = { admin?: boolean; status?: Status; source?: string; secret: string; utr?: string };

/* Shared by the public checkout and the admin counter booking. */
export async function createBooking(
  ctx: MutationCtx,
  input: { name: string; phone: string; email?: string; note?: string; items: { passId: Id<"passes">; qty: number }[] },
  opts: CreateOpts,
) {
  const admin = !!opts.admin;
  const name = clean(input.name, 80);
  const phone = normPhone(input.phone);
  const email = clean(input.email, 120).toLowerCase();
  const note = clean(input.note, 500);

  if (!admin && (await getSetting(ctx, "booking_open")) !== "1") fail("Bookings are closed right now.");
  if (name.length < 2) fail("Please enter your full name.");
  if (!validPhone(phone)) fail("Please enter a valid 10-digit mobile number.");
  if (email && !validEmail(email)) fail("That email address does not look right.");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(opts.secret)) fail("Please refresh the page and try again.");

  if (!admin) {
    // one person can't sit on the whole stock with unpaid holds
    const open = await ctx.db.query("bookings").withIndex("by_phone", (q) => q.eq("phone", phone)).collect();
    if (open.filter((b) => b.status === "awaiting_payment").length >= 3) {
      fail("You already have 3 unpaid bookings. Pay for or cancel one of them first (see My Pass).");
    }
  }

  const want = new Map<Id<"passes">, number>();
  for (const it of input.items) {
    const qty = Math.floor(it.qty);
    if (qty >= 1) want.set(it.passId, (want.get(it.passId) || 0) + qty);
  }
  if (!want.size) fail("Pick at least one pass.");
  const maxTotal = parseInt(await getSetting(ctx, "max_items_per_booking"), 10) || 20;
  const totalQty = [...want.values()].reduce((a, b) => a + b, 0);
  if (!admin && totalQty > maxTotal) fail(`You can book at most ${maxTotal} passes at a time.`);

  const today = todayIST();
  const items: Doc<"bookings">["items"] = [];
  for (const [id, qty] of want) {
    const p = await ctx.db.get(id);
    if (!p) fail("One of the passes you picked no longer exists. Please refresh.");
    const venue = await ctx.db.get(p!.venueId);
    const what = `${p!.label}${p!.date ? " · " + fmtDate(p!.date) : ""}`;
    if (!admin && (!p!.active || !venue?.active || (p!.date && p!.date < today))) fail(`${what} is not on sale any more.`);
    if (!admin && qty > p!.maxPerBooking) fail(`At most ${p!.maxPerBooking} × ${what} per booking.`);
    const available = p!.quantity - p!.held;
    if (qty > available) fail(available > 0 ? `Only ${available} left for ${what}.` : `${what} just sold out.`, "SOLD_OUT");
    items.push({
      passId: p!._id, venueId: p!.venueId, qty, unitPrice: p!.price, admits: p!.admits,
      venueName: venue?.name ?? "", passLabel: p!.label, passDate: p!.date,
    });
  }
  items.sort((a, b) => (a.passDate ?? "").localeCompare(b.passDate ?? ""));
  const amount = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);

  let code = newCode();
  while (await ctx.db.query("bookings").withIndex("by_code", (q) => q.eq("code", code)).unique()) code = newCode();

  let status: Status = opts.status ?? "awaiting_payment";
  if (status === "awaiting_payment" && amount === 0) status = "pending";
  const now = Date.now();
  const holdMin = Math.max(5, parseInt(await getSetting(ctx, "hold_minutes"), 10) || 30);
  const expiresAt = status === "awaiting_payment" ? now + holdMin * 60_000 : undefined;
  const utr = opts.utr ? normUtr(opts.utr) : undefined;

  const doc = {
    code, secret: opts.secret, name, phone, email: email || undefined, amount, status, items,
    customerNote: !admin && note ? note : undefined,
    adminNote: admin && note ? note : undefined,
    source: opts.source ?? "online",
    expiresAt,
    verifiedAt: status === "confirmed" ? now : undefined,
    paidAt: status === "confirmed" ? now : undefined,
    utr: utr || undefined,
    searchText: "",
  };
  doc.searchText = searchText(doc);
  await applyStatus(ctx, items, amount, null, status, { checkStock: false }); // checked per line above
  const id = await ctx.db.insert("bookings", doc);
  if (expiresAt) await ctx.scheduler.runAt(expiresAt, internal.bookings.expire, { id });
  return (await ctx.db.get(id))!;
}

/* Runs when a hold's time is up (a re-upload request moves expiresAt, making older jobs no-ops). */
export const expire = internalMutation({
  args: { id: v.id("bookings") },
  handler: async (ctx, { id }) => {
    const b = await ctx.db.get(id);
    if (!b || b.status !== "awaiting_payment" || !b.expiresAt || b.expiresAt > Date.now()) return;
    await applyStatus(ctx, b.items, b.amount, b.status, "expired");
    await ctx.db.patch(id, { status: "expired" });
  },
});

/* Safety net in case a scheduled job was missed. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("bookings").withIndex("by_status", (q) => q.eq("status", "awaiting_payment")).collect();
    for (const b of rows) {
      if (b.expiresAt && b.expiresAt < now) {
        await applyStatus(ctx, b.items, b.amount, b.status, "expired");
        await ctx.db.patch(b._id, { status: "expired" });
      }
    }
  },
});

export async function bookingByCode(ctx: QueryCtx, code: string) {
  return ctx.db.query("bookings").withIndex("by_code", (q) => q.eq("code", String(code || "").trim().toUpperCase())).unique();
}

/* Payment proof. Returns an error message instead of throwing when the proof
   must be kept even though the booking couldn't be re-reserved. */
export async function submitProof(ctx: MutationCtx, b: Doc<"bookings">, utrRaw: string, storageId: Id<"_storage">) {
  const utr = normUtr(utrRaw);
  // (the file itself was checked by public.submitPayment; a throw here rolls back the mutation)
  const bad = (m: string) => fail(m);
  if (!/^[A-Z0-9]{6,35}$/.test(utr)) return bad("Enter the UTR / transaction ID from your payment app (usually 12 digits).");

  if (b.status === "pending") return bad("We already have your payment proof — it is being verified.");
  if (b.status === "confirmed") return bad("This booking is already confirmed.");
  if (b.status === "rejected" || b.status === "cancelled") return bad("This booking was closed. Please contact us with your booking code.");

  const now = Date.now();
  if (b.screenshotId && b.screenshotId !== storageId) await ctx.storage.delete(b.screenshotId);
  const patch = { utr, screenshotId: storageId, paidAt: now, searchText: searchText({ ...b, utr }) };
  if (b.status === "expired" || (b.expiresAt && b.expiresAt < now)) {
    // paid just after the hold ran out: re-reserve if we still can
    const from = b.status;
    if (from === "expired") {
      const short = await shortfall(ctx, b.items);
      if (short) {
        await ctx.db.patch(b._id, patch);
        return { error: `Your hold expired and ${short} sold out meanwhile. We have saved your payment proof — please contact us with code ${b.code} for a refund or swap.` };
      }
    }
    await applyStatus(ctx, b.items, b.amount, from, "pending");
  } else {
    await applyStatus(ctx, b.items, b.amount, b.status, "pending");
  }
  await ctx.db.patch(b._id, { ...patch, status: "pending", expiresAt: undefined });
  return { error: null };
}
