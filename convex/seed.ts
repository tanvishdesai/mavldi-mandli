/* Sample data so a fresh deployment has something to show. Everything is
   editable (or deletable) in the admin panel.
   Load it with:  npx convex run seed:run   (or the button on an empty admin dashboard) */
import { internalMutation, type MutationCtx } from "./_generated/server";
import { setSetting } from "./lib";

/* Navratri plus Dussehra: ten nights. One ground, one pass per person per night. */
const NIGHTS = [
  "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
  "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20",
];
const PER_NIGHT = 800;
const VENUE_ADDRESS = "Mavaldi Mandli Ground, beside Funblast, Nikol–Hanspura Road, Naroda, Ahmedabad 382330";
const VENUE_MAP_URL = "https://maps.app.goo.gl/BweumSShRonT4cou9";

export async function seedData(ctx: MutationCtx) {
  for (const date of NIGHTS) {
    await ctx.db.insert("passes", { date, quantity: PER_NIGHT, active: true, held: 0, sold: 0, unpaid: 0 });
  }
  await setSetting(ctx, "venue_address", VENUE_ADDRESS);
  await setSetting(ctx, "venue_map_url", VENUE_MAP_URL);
  await setSetting(ctx, "venue_photo", "/assets/img/stage.webp");

  const faqs: [string, string][] = [
    ["Who needs a pass?", "Everyone aged 10 and above needs a pass for each night they come. Children below 10 enter free with a pass-holding adult."],
    ["What does a pass cost?", "₹599 per person, per night. There is one kind of pass and one ground — pick the nights you want and book that many passes."],
    ["How do I pay?", "Pay by any UPI app by scanning the QR code or using our UPI ID shown at checkout. Upload the payment screenshot and UTR number — our team verifies it and confirms your pass, usually within a few hours."],
    ["When is my pass confirmed?", "As soon as our team matches your payment. Track it any time from “My Pass” with your booking code and phone number. Once confirmed you get an e-pass with a QR code to show at the gate."],
    ["I paid but my booking expired. What now?", "Don’t pay twice. Contact us with your booking code and payment screenshot and we will sort it out."],
    ["Is there a dress code?", "Traditional attire only — chaniya choli, kediyu, kurta. Come dressed for the Mother’s courtyard."],
    ["Are passes refundable?", "Confirmed passes are non-refundable and non-transferable. Please check the night before you pay."],
    ["Is parking available?", "Limited paid parking is available near the ground. Come early on Ashtami and Navami."],
  ];
  for (const [i, [question, answer]] of faqs.entries()) await ctx.db.insert("faqs", { question, answer, sort: i + 1, active: true });
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("passes").first()) return "Nights already exist — skipped.";
    await seedData(ctx);
    return `Seeded ${NIGHTS.length} nights and sample FAQs.`;
  },
});

/* Bring an already-seeded deployment up to the NIGHTS list above, and re-point
   the venue settings, without touching nights (or bookings) that exist:
     npx convex run --prod seed:nights
   Use it when the dates or the ground change; the admin panel can do the same
   thing by hand (Nights → add a range, Settings → the ground). */
export const nights = internalMutation({
  args: {},
  handler: async (ctx) => {
    let added = 0;
    for (const date of NIGHTS) {
      const row = await ctx.db.query("passes").withIndex("by_date", (q) => q.eq("date", date)).unique();
      if (!row) { await ctx.db.insert("passes", { date, quantity: PER_NIGHT, active: true, held: 0, sold: 0, unpaid: 0 }); added++; }
    }
    await setSetting(ctx, "venue_address", VENUE_ADDRESS);
    await setSetting(ctx, "venue_map_url", VENUE_MAP_URL);
    return `${NIGHTS.length} nights on sale (${added} added); venue updated.`;
  },
});
