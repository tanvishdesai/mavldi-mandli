/* Everything a guest's browser may call. */
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  allSettings, fail, getSetting, LIMITS, limit, normPhone, PUBLIC_SETTINGS,
  todayIST, upiUri, applyStatus, type Status,
} from "./lib";
import { bookingByCode, bookingInput, createBooking as create, submitProof } from "./bookings";

export const config = query({
  args: {},
  handler: async (ctx) => {
    const s = await allSettings(ctx);
    const out: Record<string, string> = {};
    for (const k of PUBLIC_SETTINGS) out[k] = s[k];
    return out;
  },
});

export const catalogue = query({
  args: {},
  handler: async (ctx) => {
    const today = todayIST();
    const open = (await getSetting(ctx, "booking_open")) === "1";
    const venues = (await ctx.db.query("venues").collect()).filter((v) => v.active).sort((a, b) => a.sort - b.sort);
    const out = [];
    for (const v of venues) {
      const passes = (await ctx.db.query("passes").withIndex("by_venue", (q) => q.eq("venueId", v._id)).collect())
        .filter((p) => p.active)
        .sort((a, b) => (a.date === null ? -1 : 0) - (b.date === null ? -1 : 0) || (a.date ?? "").localeCompare(b.date ?? "") || a.sort - b.sort)
        .map((p) => {
          const available = Math.max(0, p.quantity - p.held);
          const past = p.date !== null && p.date < today;
          return {
            id: p._id, date: p.date, label: p.label, description: p.description ?? null, price: p.price,
            quantity: p.quantity, available, admits: p.admits, max_per_booking: p.maxPerBooking,
            past, bookable: open && !past && available > 0,
          };
        });
      out.push({
        id: v._id, name: v.name, name_gu: v.nameGu ?? null, city: v.city ?? null, address: v.address ?? null,
        map_url: v.mapUrl ?? null, description: v.description ?? null, image: v.image ?? null,
        start_time: v.startTime ?? null, passes,
      });
    }
    return { today, venues: out };
  },
});

export const faqs = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("faqs").collect())
      .filter((f) => f.active)
      .sort((a, b) => a.sort - b.sort)
      .map((f) => ({ id: f._id, question: f.question, answer: f.answer })),
});

export const createBooking = mutation({
  args: { ...bookingInput, secret: v.string() },
  handler: async (ctx, { secret, ...input }) => {
    const b = await create(ctx, input, { secret });
    return { code: b.code, amount: b.amount };
  },
});

async function owned(ctx: Parameters<typeof bookingByCode>[0], code: string, secret: string) {
  const b = await bookingByCode(ctx, code);
  if (!b || !secret || b.secret !== secret) return null;
  return b;
}

/* What a guest may see about their own booking. Live: the page updates the
   moment an admin confirms. */
export const booking = query({
  args: { code: v.string(), secret: v.string() },
  handler: async (ctx, { code, secret }) => {
    const b = await owned(ctx, code, secret);
    if (!b) return null;
    // a hold whose time is up reads as expired even before the job runs
    const status: Status = b.status === "awaiting_payment" && b.expiresAt && b.expiresAt < Date.now() ? "expired" : b.status;
    const checkins = await ctx.db.query("checkins").withIndex("by_booking", (q) => q.eq("bookingId", b._id)).collect();
    const view: Record<string, unknown> = {
      code: b.code, name: b.name, phone: b.phone.slice(0, 2) + "••••" + b.phone.slice(-4), email: b.email ?? null,
      amount: b.amount, status, utr: b.utr ?? null, has_screenshot: !!b.screenshotId,
      created_at: b._creationTime, expires_at: b.expiresAt ?? null, paid_at: b.paidAt ?? null,
      verified_at: b.verifiedAt ?? null, checkins: checkins.map((c) => c.night),
      message: ["rejected", "awaiting_payment", "cancelled"].includes(status) ? b.adminNote ?? null : null,
      items: b.items.map((i) => ({ venue: i.venueName, label: i.passLabel, date: i.passDate, qty: i.qty, unit_price: i.unitPrice, admits: i.admits })),
      admits: b.items.reduce((s, i) => s + i.qty * i.admits, 0),
    };
    if (status === "awaiting_payment") {
      const s = await allSettings(ctx);
      view.payment = {
        upi_id: s.upi_id, payee: s.upi_payee_name, uri: upiUri(s.upi_id, s.upi_payee_name, b.amount, b.code),
        qr_image: s.upi_qr_image || null, instructions: s.payment_instructions,
      };
    }
    return view;
  },
});

/* Upload URLs only for someone holding an unpaid booking. */
export const uploadUrl = mutation({
  args: { code: v.string(), secret: v.string() },
  handler: async (ctx, { code, secret }) => {
    const b = await owned(ctx, code, secret);
    if (!b) fail("Booking not found.", "NOT_FOUND");
    if (!["awaiting_payment", "expired"].includes(b!.status)) fail("This booking isn't waiting for payment.");
    // an upload URL per retry is fine; thousands of them is a free storage flood
    await limit(ctx, `upload:${b!.code}`, LIMITS.uploadPerBooking.max, LIMITS.uploadPerBooking.windowMs,
      "Too many upload attempts. Please wait a few minutes, then try again.");
    return ctx.storage.generateUploadUrl();
  },
});

/* Payment proof: the image is checked by its actual bytes (not the browser's
   claimed type), then recorded in one transaction. Rejected files are deleted. */
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const;
function sniff(b: Uint8Array): keyof typeof MIME | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (ascii(0, 3) === "GIF") return "gif";
  return null;
}

export const submitPayment = action({
  args: { code: v.string(), secret: v.string(), utr: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, a): Promise<{ error: string | null }> => {
    const blob = await ctx.storage.get(a.storageId);
    const reject = async (m: string) => { await ctx.storage.delete(a.storageId); return fail(m); };
    if (!blob) return fail("Upload failed. Please attach the screenshot again.");
    if (blob.size > 8 * 1024 * 1024) return reject("That image is too large (max 8 MB).");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const kind = sniff(bytes.subarray(0, 16));
    if (!kind) {
      return reject("Please upload a JPG, PNG or WebP image (HEIC photos: take a screenshot instead).");
    }
    /* The browser chose the Content-Type on the original upload, so a file with
       image magic bytes could still be served as text/html from the Convex
       storage origin and run when an admin opens it. Re-store the same bytes
       under the type we actually detected, and drop the client-typed original. */
    const safeId = await ctx.storage.store(new Blob([bytes], { type: MIME[kind] }));
    await ctx.storage.delete(a.storageId);
    try {
      return await ctx.runMutation(internal.public._recordPayment, { ...a, storageId: safeId });
    } catch (e) {
      await ctx.storage.delete(safeId);
      throw e;
    }
  },
});

export const _recordPayment = internalMutation({
  args: { code: v.string(), secret: v.string(), utr: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { code, secret, utr, storageId }) => {
    const b = await owned(ctx, code, secret);
    if (!b) fail("Booking not found.", "NOT_FOUND");
    return submitProof(ctx, b as Doc<"bookings">, utr, storageId);
  },
});

export const cancelBooking = mutation({
  args: { code: v.string(), secret: v.string() },
  handler: async (ctx, { code, secret }) => {
    const b = await owned(ctx, code, secret);
    if (!b) fail("Booking not found.", "NOT_FOUND");
    if (b!.status !== "awaiting_payment") fail("Only unpaid bookings can be cancelled here. Contact us for anything else.");
    await applyStatus(ctx, b!.items, b!.amount, b!.status, "cancelled");
    await ctx.db.patch(b!._id, { status: "cancelled", expiresAt: undefined });
  },
});

/* Find my booking: code + phone -> the secret that opens it.
   This is the one public endpoint where guessing pays, so it is rate limited on
   both halves of the pair: by code (hunting for the matching phone) and by phone
   (someone who knows a guest's number, hunting for their code).

   It has to be an action calling a separate counting mutation, not a single
   mutation: a Convex mutation that throws rolls back its own writes, so a
   counter incremented in the same transaction as the failure would never
   persist and the limit would never bite. Same shape as auth.login. */
const LOOKUP_BUSY = "Too many attempts. Please wait 15 minutes, or contact us with your booking code.";

export const _lookupAttempt = internalMutation({
  args: { code: v.string(), phone: v.string() },
  handler: async (ctx, { code, phone }) => {
    await limit(ctx, `lookupc:${code}`, LIMITS.lookupPerCode.max, LIMITS.lookupPerCode.windowMs, LOOKUP_BUSY);
    if (phone) {
      await limit(ctx, `lookupp:${phone}`, LIMITS.lookupPerPhone.max, LIMITS.lookupPerPhone.windowMs, LOOKUP_BUSY);
    }
  },
});

export const _lookupFind = internalQuery({
  args: { code: v.string(), phone: v.string() },
  handler: async (ctx, { code, phone }) => {
    const b = await bookingByCode(ctx, code);
    if (!b || b.phone !== phone) return null;
    return { code: b.code, secret: b.secret };
  },
});

export const lookup = action({
  args: { code: v.string(), phone: v.string() },
  handler: async (ctx, { code, phone }): Promise<{ code: string; secret: string }> => {
    if (!String(code).trim()) fail("Enter your booking code (it starts with MV).");
    const dialled = normPhone(phone);
    const norm = String(code).trim().toUpperCase().slice(0, 16);
    await ctx.runMutation(internal.public._lookupAttempt, { code: norm, phone: dialled });
    const found = await ctx.runQuery(internal.public._lookupFind, { code: norm, phone: dialled });
    if (!found) fail("No booking matches that code and phone number.", "NOT_FOUND");
    return found!;
  },
});
