# માવલડી મંડળી — Mavladi Mandli garba passes

Online garba pass booking for Navratri. Guests pick a venue, nights and pass type, pay by **UPI** (QR code or UPI ID), and upload a payment screenshot and UTR number. The team checks each payment by hand in the admin panel. The guest's QR e-pass goes live only after that check.

## Run it

```bash
npm install
npm start               # http://localhost:3000   ·   admin: http://localhost:3000/admin
npm test                # API integration tests (throwaway DB)
```

On first boot the database is created in `./data/` and filled with **sample data**: two venues, nine nights (11–19 Oct 2026), daily, couple and season passes, and FAQs. Edit or delete all of it from the admin panel.

**Admin password:** `ADMIN_PASSWORD` if set on first boot, otherwise `mavladi2026`. The dashboard shows a warning until you change it in **Settings**.

**Before going live**, open Admin → Settings and set your real **UPI ID** and **payee name**. Also set the contact number/WhatsApp, and fix the event dates and text.

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite DB + uploaded screenshots. **Must be persistent storage.** |
| `ADMIN_PASSWORD` | `mavladi2026` | Initial admin password (first boot only) |
| `TRUST_PROXY` | – | Set `true` behind HTTPS proxies (Render, Railway, nginx) so cookies get `Secure` and rate limits see real IPs |
| `PUBLIC_URL` | request host | Base URL encoded in ticket QR codes |
| `SESSION_SECRET` | auto (stored in DB) | Cookie signing key |

For local runs with a file: `node --env-file=.env server/index.js` (see `.env.example`).

### Deploying

This is a normal Node server with a SQLite file and an uploads folder, so it needs a **persistent disk**. Serverless hosts like Vercel or Netlify Functions won't work. Good fits:

- **Render / Railway / Fly.io**: attach a volume and set `DATA_DIR` to its mount path.
- **Any VPS**: `docker build -t mavladi . && docker run -p 3000:3000 -v mavladi-data:/data mavladi`

Back up `DATA_DIR` (it holds the DB and every payment screenshot).

## How it works

### Guest flow
1. **Home** (`/`): the scroll journey (see below), live venue cards with prices and how many passes are left, and FAQs.
2. **Book** (`/book`): pick a venue, then season or daily passes per night, each showing price, stock and max per booking. Enter name, phone and optional email, then press **Reserve & pay**.
3. **Pay** (`/ticket?code=…&t=…`): the passes are **held** for a set time (default 30 min, set in Settings) with a countdown. The page shows:
   - a UPI QR code built for this booking, with the exact amount and booking code already filled in. You can upload your own fixed QR instead in Settings.
   - the UPI ID with a copy button, and an "Open UPI app" deep link on phones.
   - an upload form for the screenshot and UTR.
4. **Verifying**: the page checks for updates by itself. The guest can find it again later from **My Pass** using booking code + phone. Bookings made on the same device are listed there too.
5. **Confirmed**: a printable e-pass with a QR code for the gate.

### Admin (`/admin`)
- **Dashboard**: payments waiting for verification, confirmed revenue, passes sold/held, check-ins tonight, and stock per venue and night.
- **Bookings**: filter by status, venue or date, or search by code/name/phone/UTR. Opening a booking shows the **screenshot**, UTR, amount and passes, plus warnings when the **same UTR appears on another booking** and a list of the guest's other bookings. Actions:
  - **Confirm**, **Reject** (with a reason the guest sees), or **Ask to re-upload** (holds the passes 24 h more).
  - **Cancel**, **Reopen**, edit guest details, delete.
  - A prefilled **WhatsApp message** to the guest.
  - In the queue, `c` confirms, `r` rejects, and `j`/`k` move between bookings. After each decision the next booking opens.
- **Counter booking**: record cash or offline sales. Stock is still checked.
- **Gate check-in**: scan the guest's QR (with the in-browser camera scanner where supported, or the phone camera, which opens the page with the code filled in) or type the code. Shows a green/amber/red result, one check-in per night, so season passes work every night. It warns when a pass is for a different night.
- **Venues, Passes & dates, FAQs**: full create/edit/delete. "Add many nights" creates a pass for a whole date range in one go.
- **Settings**: UPI details, payment window, booking on/off, event text, contact, admin password.
- **Export CSV** of any filtered booking list.

### Rules that keep stock honest
- Stock counts bookings that are *awaiting payment*, *pending* or *confirmed*. Two people can't both buy the last pass, because each booking is created in one SQLite transaction.
- Unpaid holds expire on their own and the passes go back on sale. If proof arrives just after expiry, the booking is kept when the passes are still available. If not, the proof is saved and the guest is asked to contact you.
- Rejected, cancelled and expired bookings free their passes. Reopening one checks stock again.
- Screenshots are private: only a signed-in admin can load them. Uploads are checked by file content (JPG/PNG/WebP/GIF only, 8 MB max).
- Admin sessions use an HttpOnly, SameSite=Strict signed cookie plus a custom request header. Login, booking and lookup are rate-limited.

## The scroll journey

Built with the same technique as mandligarba.co.in's "walk into the woods": a fixed stage and a **virtual camera whose depth is driven by scroll**. Everything is drawn by projecting world coordinates (`screen = centre + world × focal / depth`) onto one canvas, painted far to near.

1. You start in front of the entry gate photo and scroll **through its arch**: the photo zooms from the arch's opening and dissolves.
2. You walk down the *Mavladi Yatra*: banners (મમતા, શક્તિ, ભક્તિ, આનંદ, ઉત્સવ, પરંપરા…), string lights, swaying lanterns and flickering diyas along the path.
3. Content sections stand along the path. Each one rises out of the vanishing point, holds while you read (tall sections scroll through their own content at reading speed), then drifts away.
4. At the end the camera rises and tilts down for a **drone's-eye view of the garba ring**: circles of dancers turning in opposite directions around a glowing garbo and a rangoli mandala, with the logo on top.

Also included: a side rail with one diya per section for jumping between them, a floating "Book Passes" button, a lighter scene on low-end phones, reduced-motion support (the scene stays, but without easing or drift) and a readable no-JavaScript fallback.

## Project layout

```
server/
  index.js      routes (public + admin API, uploads, static)
  bookings.js   booking rules: create, holds, payment proof, admin transitions, check-in
  db.js         schema + settings
  auth.js       admin password, signed cookie, throttling
  seed.js       sample data
public/
  index.html    home (scroll journey)      assets/js/home.js
  book.html     booking                    assets/js/book.js
  ticket.html   pay / status / e-pass      assets/js/ticket.js
  admin/        admin panel                assets/js/admin.js
  assets/css    base (tokens), home, pages, admin
  assets/img    logo (cut out from the brand art), gate, venue photos
test/           node:test API tests
```
