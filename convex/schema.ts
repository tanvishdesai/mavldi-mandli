import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* Booking status:
     awaiting_payment -> pending -> confirmed
     awaiting_payment -> expired | cancelled
     pending -> rejected | awaiting_payment (re-upload asked)
     confirmed -> cancelled
   Stock is held while a booking is awaiting_payment, pending or confirmed;
   each pass keeps running `held` / `sold` counters so availability is one read. */
export const bookingStatus = v.union(
  v.literal("awaiting_payment"),
  v.literal("pending"),
  v.literal("confirmed"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("expired"),
);

export const bookingItem = v.object({
  passId: v.id("passes"),
  venueId: v.id("venues"),
  qty: v.number(),
  unitPrice: v.number(),
  admits: v.number(),
  // snapshot so history survives edits
  venueName: v.string(),
  passLabel: v.string(),
  passDate: v.union(v.string(), v.null()), // YYYY-MM-DD, null = season pass
});

export default defineSchema({
  settings: defineTable({ key: v.string(), value: v.string() }).index("by_key", ["key"]),

  venues: defineTable({
    name: v.string(),
    nameGu: v.optional(v.string()),
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    mapUrl: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    startTime: v.optional(v.string()),
    active: v.boolean(),
    sort: v.number(),
  }),

  passes: defineTable({
    venueId: v.id("venues"),
    date: v.union(v.string(), v.null()),
    label: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    quantity: v.number(),
    maxPerBooking: v.number(),
    admits: v.number(),
    active: v.boolean(),
    sort: v.number(),
    held: v.number(), // awaiting_payment + pending + confirmed
    sold: v.number(), // confirmed only
    // awaiting_payment only: nobody has paid for these yet, so a flood of them is
    // how you deny the whole event its stock. Capped per pass in createBooking.
    // Optional so existing rows need no migration; absent reads as 0.
    unpaid: v.optional(v.number()),
  }).index("by_venue", ["venueId"]),

  bookings: defineTable({
    code: v.string(),
    secret: v.string(), // chosen by the guest's browser; proves ownership
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    amount: v.number(),
    status: bookingStatus,
    items: v.array(bookingItem),
    utr: v.optional(v.string()),
    screenshotId: v.optional(v.id("_storage")),
    customerNote: v.optional(v.string()),
    adminNote: v.optional(v.string()),
    source: v.string(), // online | counter
    expiresAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    lastCheckinAt: v.optional(v.number()),
    searchText: v.string(),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status"])
    .index("by_phone", ["phone"])
    .index("by_utr", ["utr"])
    .searchIndex("search", { searchField: "searchText", filterFields: ["status"] }),

  // one row per night a booking was admitted (season passes come every night)
  checkins: defineTable({ bookingId: v.id("bookings"), night: v.string(), at: v.number() })
    .index("by_booking", ["bookingId", "night"])
    .index("by_night", ["night"]),

  // running totals per status for the dashboard
  counters: defineTable({ status: v.string(), n: v.number(), amount: v.number() }).index("by_status", ["status"]),

  faqs: defineTable({ question: v.string(), answer: v.string(), sort: v.number(), active: v.boolean() }),

  sessions: defineTable({ token: v.string(), expiresAt: v.number() }).index("by_token", ["token"]),

  // rate limiting: one row per bucket key (login, booking:<phone>, lookup:<code>, …)
  attempts: defineTable({ key: v.string(), count: v.number(), resetAt: v.number() }).index("by_key", ["key"]),

  /* Append-only record of the actions that move money or change where money goes.
     With a single shared admin password this cannot attribute to a person, but it
     answers "what changed, when, and from what" during reconciliation. */
  auditLog: defineTable({
    at: v.number(),
    action: v.string(), // settings.upi_id | booking.confirm | booking.delete | password.change | …
    subject: v.optional(v.string()), // booking code, setting key, …
    before: v.optional(v.string()),
    after: v.optional(v.string()),
    note: v.optional(v.string()),
  }).index("by_at", ["at"]),
});
