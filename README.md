# માવલડી મંડળી — Mavladi Mandli garba passes

Online garba pass booking for Navratri. Guests pick a venue, nights and pass type, pay by **UPI** (QR code or UPI ID), and upload a payment screenshot and UTR number. The team checks each payment by hand in the admin panel. The guest's QR e-pass goes live only after that check.

- **Backend + database:** [Convex](https://convex.dev). You can run it yourself with Docker (`self-hosted/`), or use Convex cloud; the code is the same either way.
- **Frontend:** plain HTML/CSS/JS in `public/`, deployed as a static site on **Vercel**. The build step only copies in the Convex browser client and writes the backend URL.

Changes show up **live** everywhere. The admin queue gets new payments as they arrive, and the guest's page turns into the e-pass the moment you confirm. Nobody has to refresh.

---

## 1. Run the Convex backend yourself

You need a small server (1 vCPU / 1 GB is plenty to start) with Docker, and two DNS names pointing at it, for example `api.mavladi.example` and `convex.mavladi.example`.

```bash
cd self-hosted
cp .env.example .env            # set CONVEX_API_DOMAIN and CONVEX_DASHBOARD_DOMAIN
docker compose up -d            # Convex backend + dashboard + Caddy (automatic HTTPS)
docker compose exec backend ./generate_admin_key.sh   # copy the key it prints
```

- Your backend URL is `https://api.mavladi.example`. The site uses it as its `CONVEX_URL`.
- The dashboard is at `https://convex.mavladi.example`; sign in with the admin key. It lets you browse tables, logs and files.
- Data, including every uploaded screenshot, lives in the `data` Docker volume. **Back it up.** Postgres is optional: set `POSTGRES_URL` in `.env`.

Then, from the project root on your computer:

```bash
npm install
cat > .env.local <<EOF
CONVEX_SELF_HOSTED_URL=https://api.mavladi.example
CONVEX_SELF_HOSTED_ADMIN_KEY=<the admin key>
EOF
npx convex deploy                                  # push the functions + schema
npx convex env set ADMIN_PASSWORD 'something-strong'   # first admin password
npx convex run seed:run                            # optional sample data
```

> Prefer Convex cloud? Run `npx convex dev` once to create a project, then use `CONVEX_DEPLOY_KEY` (a production deploy key from the Convex dashboard) wherever this README says `CONVEX_SELF_HOSTED_*`.

## 2. Put the frontend on Vercel

1. Import this repo in Vercel. `vercel.json` already sets the build (`npm run vercel-build`), the output folder (`public`) and clean URLs (`/book`, `/ticket`, `/admin`).
2. In **Project → Settings → Environment Variables**, add:
   - `CONVEX_SELF_HOSTED_URL` = `https://api.mavladi.example`
   - `CONVEX_SELF_HOSTED_ADMIN_KEY` = the admin key

   With these set, every Vercel deploy **also pushes the Convex functions** and builds the site against that backend.
   If you'd rather deploy functions yourself and keep the admin key out of Vercel, set only `CONVEX_URL=https://api.mavladi.example` instead.
3. Deploy. Then open `https://<your-site>/admin`, sign in with `ADMIN_PASSWORD` (the default is `mavladi2026` if you didn't set one; the dashboard warns until you change it), and:
   - load the sample data or add your venues and passes, and
   - under **Settings**, enter your real **UPI ID** and **payee name**. Payments go to this ID, so double-check it.

## Local development

```bash
npm install
npx convex dev          # against your self-hosted backend (.env.local) or a Convex cloud dev deployment
npm run build           # writes public/env.js + public/vendor/ from .env.local
npx serve public        # or any static server that maps /book → book.html
npm test                # backend tests (convex-test, in-memory)
npm run typecheck
```

---

## How it works

### Guest flow
1. **Home** (`/`): the scroll journey, live venue cards with prices and passes left, and FAQs.
2. **Book** (`/book`): pick a venue, then season or daily passes per night. Enter name, phone and optional email, then press **Reserve & pay**.
3. **Pay** (`/ticket?code=…&t=…`): the passes are **held** for a set time (30 min by default) with a countdown. The page shows:
   - a UPI QR code made in the browser for this booking, with the exact amount and booking code filled in. You can upload your own fixed QR in Settings instead.
   - the UPI ID with a copy button, and an "Open UPI app" button on phones.
   - an upload form for the screenshot and UTR. The file goes straight into Convex storage.
4. **Verifying**: the page updates by itself. The guest can find it again from **My Pass** with booking code + phone, from any device.
5. **Confirmed**: a printable e-pass with a gate QR code.

The booking link has a secret made in the guest's browser (`t=`). Without it, or without code + phone, nobody can see the booking.

### Admin (`/admin`)
- **Dashboard** (live): payments waiting for verification, confirmed revenue, passes sold and held, check-ins tonight, and stock per night. On an empty database it offers to load the sample data.
- **Bookings** (live): filter by status, venue or date, or search by code/name/phone/UTR. Opening a booking shows:
  - the **screenshot**, UTR, amount and passes;
  - a warning when the **same UTR appears on another booking**, and a list of the guest's other bookings;
  - buttons to **Confirm**, **Reject** (with a reason the guest sees), or **Ask to re-upload** (holds the passes 24 h more), plus cancel, reopen, edit and delete;
  - a prefilled WhatsApp message to the guest.

  Keyboard shortcuts: `c` confirms, `r` rejects, `j`/`k` move between bookings. After each decision the next one opens.
- **Counter booking** for cash sales, **CSV export**.
- **Gate check-in**: scan the QR (in-browser camera scanner, or the phone camera, which opens the page with the code filled in) or type the code. One check-in per night, so season passes work every night. It warns when a pass is for another night.
- **Venues** (with photo upload), **Passes & dates** ("add many nights" creates a whole date range at once), **FAQs**, **Settings** (UPI, payment window, booking on/off, texts, contact, password).

### Rules that keep stock honest
- Each pass keeps running `held` and `sold` counters, updated in the **same Convex transaction** as the booking's status. Two people can never both buy the last pass.
- Unpaid holds expire through a **scheduled function** at exactly their deadline, with a 10-minute cron as a safety net. If proof arrives just after expiry, the booking is kept when the passes are still available. If not, the proof is saved and the guest is asked to contact you.
- A phone number can have at most 3 unpaid holds at once, so nobody can sit on the stock.
- Payment screenshots are checked by their **actual bytes** (JPG/PNG/WebP/GIF only, 8 MB max). Rejected files are deleted.
- Admin: the password is hashed with PBKDF2 and failed logins are throttled. Sessions use tokens made in the browser and expire after 7 days. Changing the password signs out every other device.

## The scroll journey

Built with the same technique as mandligarba.co.in's "walk into the woods": a fixed stage and a **virtual camera whose depth is driven by scroll**. Everything is drawn by projecting world coordinates onto one canvas.

1. You scroll **through the arch of the entry gate**.
2. You walk down a corridor of banners (મમતા, શક્તિ, ભક્તિ…), string lights, lanterns and diyas.
3. Content sections rise out of the vanishing point as you reach them.
4. The camera rises for a **drone's-eye view of the garba ring**, with dancers circling a glowing garbo.

It uses a lighter scene on low-end phones and supports reduced motion.

## Project layout

```
convex/                 backend (runs on your Convex deployment)
  schema.ts             tables + indexes
  public.ts             guest API: catalogue, booking, payment proof, lookup
  admin.ts              admin API: dashboard, bookings, check-in, CRUD, settings
  auth.ts               admin password + sessions
  bookings.ts           booking rules shared by both (create, expire, proof)
  lib.ts                status transitions, counters, validation, settings
  seed.ts, crons.ts     sample data, hold-expiry safety net
  booking.test.ts       convex-test suite
public/                 static site (Vercel output)
  index.html, book.html, ticket.html, admin/
  assets/js             common.js (Convex client), home, book, ticket, admin
scripts/                build.mjs (vendor + env.js), vercel-build.mjs
self-hosted/            docker-compose.yml, Caddyfile, .env.example
vercel.json
```
