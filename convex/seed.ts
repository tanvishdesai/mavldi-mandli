/* Sample data so a fresh deployment has something to show. Everything is
   editable (or deletable) in the admin panel.
   Load it with:  npx convex run seed:run   (or the button on an empty admin dashboard) */
import { internalMutation, type MutationCtx } from "./_generated/server";

const NIGHTS: [string, string][] = [
  ["2026-10-11", "Pratipada"], ["2026-10-12", "Dwitiya"], ["2026-10-13", "Tritiya"],
  ["2026-10-14", "Chaturthi"], ["2026-10-15", "Panchami"], ["2026-10-16", "Shashthi"],
  ["2026-10-17", "Saptami"], ["2026-10-18", "Ashtami"], ["2026-10-19", "Navami"],
];

export async function seedData(ctx: MutationCtx) {
  const main = await ctx.db.insert("venues", {
    name: "Maa nu Aangnu — Main Ground", nameGu: "મા નું આંગણું", city: "Vadodara",
    address: "Main Garba Ground, Vadodara, Gujarat", mapUrl: "https://maps.google.com/?q=Vadodara",
    description: "The big circle. Live orchestra, the Mataji sthapana at the centre and room for thousands in the ring.",
    image: "/assets/img/stage.webp", startTime: "8:30 pm onwards", active: true, sort: 1,
  });
  const sheri = await ctx.db.insert("venues", {
    name: "Sheri Garba — Old City Chowk", nameGu: "શેરી ગરબા", city: "Vadodara",
    address: "Old City Chowk, Vadodara, Gujarat", mapUrl: "https://maps.google.com/?q=Vadodara",
    description: "Lanterns, dhol and the old circles, danced the old way in the lanes. Smaller, closer, louder.",
    image: "/assets/img/courtyard.webp", startTime: "9:00 pm onwards", active: true, sort: 2,
  });
  const pass = (venueId: typeof main, date: string | null, label: string, description: string, price: number, quantity: number, maxPerBooking: number, admits: number, sort: number) =>
    ctx.db.insert("passes", { venueId, date, label, description, price, quantity, maxPerBooking, admits, active: true, sort, held: 0, sold: 0 });

  for (const [i, [date, tithi]] of NIGHTS.entries()) {
    const big = i >= 7; // Ashtami and Navami are the big nights
    await pass(main, date, "Daily Pass", `Night ${i + 1} · ${tithi}`, big ? 399 : 299, 600, 10, 1, 1);
    await pass(main, date, "Couple Pass", `Night ${i + 1} · ${tithi} · admits two`, big ? 699 : 549, 150, 5, 2, 2);
    await pass(sheri, date, "Daily Pass", `Night ${i + 1} · ${tithi}`, big ? 249 : 199, 250, 10, 1, 1);
  }
  await pass(main, null, "Season Pass", "All nine nights · one person", 1999, 300, 6, 1, 0);
  await pass(sheri, null, "Season Pass", "All nine nights · one person", 1299, 120, 6, 1, 0);

  const faqs: [string, string][] = [
    ["Who needs a pass?", "Everyone aged 10 and above needs a valid pass. Children below 10 enter free with a pass-holding adult."],
    ["How do I pay?", "Pay by any UPI app by scanning the QR code or using our UPI ID shown at checkout. Upload the payment screenshot and UTR number — our team verifies it and confirms your pass, usually within a few hours."],
    ["When is my pass confirmed?", "As soon as our team matches your payment. Track it any time from “My Pass” with your booking code and phone number. Once confirmed you get an e-pass with a QR code to show at the gate."],
    ["I paid but my booking expired. What now?", "Don’t pay twice. Contact us with your booking code and payment screenshot and we will sort it out."],
    ["Is there a dress code?", "Traditional attire only — chaniya choli, kediyu, kurta. Come dressed for the Mother’s courtyard."],
    ["Are passes refundable?", "Confirmed passes are non-refundable and non-transferable. Please check the venue and night before you pay."],
    ["Is parking available?", "Limited paid parking is available near each venue. Come early on Ashtami and Navami."],
  ];
  for (const [i, [question, answer]] of faqs.entries()) await ctx.db.insert("faqs", { question, answer, sort: i + 1, active: true });
}

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query("venues").first()) return "Venues already exist — skipped.";
    await seedData(ctx);
    return "Seeded sample venues, passes and FAQs.";
  },
});
