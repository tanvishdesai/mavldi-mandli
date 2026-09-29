'use strict';
/* Sample data so a fresh install has something to show. Everything here is
   editable (or deletable) from the admin panel. Runs automatically when the
   venues table is empty; `npm run seed` forces it. */
const { db } = require('./db');

const NIGHTS = [
  ['2026-10-11', 'Pratipada'], ['2026-10-12', 'Dwitiya'], ['2026-10-13', 'Tritiya'],
  ['2026-10-14', 'Chaturthi'], ['2026-10-15', 'Panchami'], ['2026-10-16', 'Shashthi'],
  ['2026-10-17', 'Saptami'], ['2026-10-18', 'Ashtami'], ['2026-10-19', 'Navami'],
];

function seed() {
  const insVenue = db.prepare(
    `INSERT INTO venues (name, name_gu, city, address, map_url, description, image, start_time, sort)
     VALUES (@name, @name_gu, @city, @address, @map_url, @description, @image, @start_time, @sort)`
  );
  const insPass = db.prepare(
    `INSERT INTO passes (venue_id, date, label, description, price, quantity, max_per_booking, admits, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insFaq = db.prepare('INSERT INTO faqs (question, answer, sort) VALUES (?, ?, ?)');

  db.transaction(() => {
    const main = insVenue.run({
      name: 'Maa nu Aangnu — Main Ground',
      name_gu: 'મા નું આંગણું',
      city: 'Vadodara',
      address: 'Main Garba Ground, Vadodara, Gujarat',
      map_url: 'https://maps.google.com/?q=Vadodara',
      description: 'The big circle. Live orchestra, the Mataji sthapana at the centre and room for thousands in the ring.',
      image: '/assets/img/stage.webp',
      start_time: '8:30 pm onwards',
      sort: 1,
    }).lastInsertRowid;
    const sheri = insVenue.run({
      name: 'Sheri Garba — Old City Chowk',
      name_gu: 'શેરી ગરબા',
      city: 'Vadodara',
      address: 'Old City Chowk, Vadodara, Gujarat',
      map_url: 'https://maps.google.com/?q=Vadodara',
      description: 'Lanterns, dhol and the old circles, danced the old way in the lanes. Smaller, closer, louder.',
      image: '/assets/img/courtyard.webp',
      start_time: '9:00 pm onwards',
      sort: 2,
    }).lastInsertRowid;

    NIGHTS.forEach(([date, tithi], i) => {
      const big = i >= 7; // Ashtami and Navami are the big nights
      insPass.run(main, date, 'Daily Pass', `Night ${i + 1} · ${tithi}`, big ? 399 : 299, 600, 10, 1, 1);
      insPass.run(main, date, 'Couple Pass', `Night ${i + 1} · ${tithi} · admits two`, big ? 699 : 549, 150, 5, 2, 2);
      insPass.run(sheri, date, 'Daily Pass', `Night ${i + 1} · ${tithi}`, big ? 249 : 199, 250, 10, 1, 1);
    });
    insPass.run(main, null, 'Season Pass', 'All nine nights · one person', 1999, 300, 6, 1, 0);
    insPass.run(sheri, null, 'Season Pass', 'All nine nights · one person', 1299, 120, 6, 1, 0);

    [
      ['Who needs a pass?', 'Everyone aged 10 and above needs a valid pass. Children below 10 enter free with a pass-holding adult.'],
      ['How do I pay?', 'Pay by any UPI app by scanning the QR code or using our UPI ID shown at checkout. Upload the payment screenshot and UTR number — our team verifies it and confirms your pass, usually within a few hours.'],
      ['When is my pass confirmed?', 'As soon as our team matches your payment. Track it any time from “My Pass” with your booking code and phone number. Once confirmed you get an e-pass with a QR code to show at the gate.'],
      ['I paid but my booking expired. What now?', 'Don’t pay twice. Contact us with your booking code and payment screenshot and we will sort it out.'],
      ['Is there a dress code?', 'Traditional attire only — chaniya choli, kediyu, kurta. Come dressed for the Mother’s courtyard.'],
      ['Are passes refundable?', 'Confirmed passes are non-refundable and non-transferable. Please check the venue and night before you pay.'],
      ['Is parking available?', 'Limited paid parking is available near each venue. Come early on Ashtami and Navami.'],
    ].forEach(([q, a], i) => insFaq.run(q, a, i + 1));
  })();
}

function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM venues').get();
  if (n === 0) {
    seed();
    return true;
  }
  return false;
}

module.exports = { seed, seedIfEmpty };

if (require.main === module) {
  seed();
  console.log('Seeded sample venues, passes and FAQs.');
}
