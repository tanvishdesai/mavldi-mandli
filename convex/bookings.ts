import { v } from "convex/values";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  applyStatus, clean, fail, getSetting, isHolding, LIMITS, limit, normPhone, normUtr, searchText,
  todayIST, validEmail, validPhone, fmtDate, shortfall, type Status,
} from "./lib";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/* 8 characters = 32^8 ≈ 1.1e12. The code is what the gate scans, so it wants to
   be well past guessable; Convex seeds Math.random() with a strong PRNG. */
function newCode() {
  let s = "MV";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/* A UTR identifies exactly one real UPI transaction, so it may back exactly one
   booking. Without this, one genuine payment screenshot confirms unlimited
   bookings and the only control is an admin noticing a warning banner. */
export async function utrOwner(ctx: QueryCtx, utr: string, exceptId?: Id<"bookings">) {
  const rows = await ctx.db.query("bookings").withIndex("by_utr", (q) => q.eq("utr", utr)).collect();
  return rows.find((b) => b._id !== exceptId && isHolding(b.status)) ?? null;
}

export const bookingInput = {
  name: v.string(),
  phone: v.string(),
  email: v.optional(v.string()),
  note: v.optional(v.string()),
  items: v.array(v.object({ passId: v.id("passes"), qty: v.number() })),
};

type CreateOpts = { admin?: boolean; status?: Status; source?: string; secret: string; utr?: string };

/* Shared by the public checkout and the admin counter booking.
   One ground, one kind of pass: a booking is just "n passes for night X". */
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
    // and can't churn through new phone-shaped strings for free either
    await limit(ctx, `booking:${phone}`, LIMITS.bookingsPerPhone.max, LIMITS.bookingsPerPhone.windowMs,
      "Too many booking attempts from this number. Please try again in a little while.");
    /* Ceiling on unpaid holds event-wide. The per-phone caps above are keyed on
       an attacker-supplied number, so this is the backstop that keeps a script
       with ten thousand fake numbers from parking the whole event. */
    const holdsNow = await ctx.db.query("counters").withIndex("by_status", (q) => q.eq("status", "awaiting_payment")).unique();
    if ((holdsNow?.n ?? 0) >= LIMITS.maxOpenHolds) {
      fail("A lot of people are paying right now. Please try again in a few minutes.", "BUSY");
    }
  }

  const want = new Map<Id<"passes">, number>();
  for (const it of input.items) {
    const qty = Math.floor(it.qty);
    if (qty >= 1) want.set(it.passId, (want.get(it.passId) || 0) + qty);
  }
  if (!want.size) fail("Pick at least one night.");
  const maxTotal = parseInt(await getSetting(ctx, "max_items_per_booking"), 10) || 20;
  const totalQty = [...want.values()].reduce((a, b) => a + b, 0);
  if (!admin && totalQty > maxTotal) fail(`You can book at most ${maxTotal} passes at a time.`);

  // the one price there is; snapshotted per line so a later change leaves history alone
  const price = Math.max(0, Math.floor(parseFloat(await getSetting(ctx, "pass_price")) || 0));
  const today = todayIST();
  const items: Doc<"bookings">["items"] = [];
  for (const [id, qty] of want) {
    const p = await ctx.db.get(id);
    if (!p) fail("One of the nights you picked is no longer on sale. Please refresh.");
    const what = fmtDate(p!.date);
    if (!admin && (!p!.active || p!.date < today)) fail(`${what} is not on sale any more.`);
    const available = p!.quantity - p!.held;
    if (qty > available) fail(available > 0 ? `Only ${available} left for ${what}.` : `${what} just sold out.`, "SOLD_OUT");
    /* Unpaid holds may never cover more than a quarter of a night. Nobody paying
       normally notices; a flood of fake holds can delay at most 25% of sales. */
    if (!admin) {
      const unpaidCap = Math.max(maxTotal, Math.floor(p!.quantity * LIMITS.unpaidShareOfStock));
      if (p!.unpaid + qty > unpaidCap) {
        fail(`${what} has a lot of unpaid holds right now. Please try again in a few minutes.`, "BUSY");
      }
    }
    items.push({ passId: p!._id, date: p!.date, qty, unitPrice: price });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
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

/* Safety net in case a scheduled job was missed, plus routine tidying. */
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
    // spent rate-limit buckets: one row per phone/code otherwise accumulates forever
    for (const a of await ctx.db.query("attempts").take(500)) {
      if (a.key !== "login" && a.resetAt < now - 3600_000) await ctx.db.delete(a._id);
    }
  },
});

/* Files uploaded through a one-time upload URL but never attached to a booking.
   Without this, anyone holding one booking can fill storage for free. */
export const sweepOrphanFiles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 6 * 3600_000; // leave recent uploads alone: they may be mid-submit
    const used = new Set<string>();
    for (const b of await ctx.db.query("bookings").collect()) if (b.screenshotId) used.add(b.screenshotId);
    /* The ground photo and the UPI QR are stored as getUrl() strings in settings,
       not storage ids, so collect the ids embedded in those URLs too — deleting
       one of those would blank the payment QR. */
    const haystack = (await ctx.db.query("settings").collect()).map((s) => s.value).join(" ");
    let removed = 0;
    for (const f of await ctx.db.system.query("_storage").take(1000)) {
      if (f._creationTime < cutoff && !used.has(f._id) && !haystack.includes(f._id)) {
        await ctx.storage.delete(f._id);
        if (++removed >= 200) break; // keep each run small
      }
    }
    return removed;
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

  /* One real transaction backs one booking. Refused outright rather than merely
     flagged, so reusing a screenshot cannot reach the verification queue. */
  const clash = await utrOwner(ctx, utr, b._id);
  if (clash) {
    return bad(
      `That UTR is already recorded against booking ${clash.code}. ` +
        "Each payment can only be used once — check you copied the right transaction ID, " +
        "or contact us with your booking code.",
    );
  }

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
