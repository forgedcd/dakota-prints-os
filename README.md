# Dakota Prints OS — backend operating system

The private back office for **Dakota Prints** (Williston, SD): screen printing, embroidery,
signs, vinyl, blueprints and business print.

This repo is **the OS only** — there is no customer storefront inside it. The root URL is a
login screen; everything behind it is the operator tool. The public website
(`dakotaprints.com`) is a separate project that talks to this service over three HTTP
endpoints (order intake, catalog sync, order tracking).

```
os.dakotaprints.com   →  this repo   (login-gated OS + public API)
www.dakotaprints.com  →  the website (separate repo, posts orders here)
```

---

## Catalog management (OS → website)

The **Products** page is a full catalog manager: a Published switch per product (optimistic,
with a *Live on site* / *Hidden* chip), website ordering, duplicate/archive/delete, bulk
publish/unpublish/recategorise, and an editor with five sections — Details (name, slug, SKU,
badge, descriptions), Pricing (base price, quantity breaks with validation, live example-price
calculator), Sizes & options (variant table with absolute price *or* upcharge, stock, reorder,
one-click standard apparel sizes), Images (drag-and-drop multi-upload, set primary, alt text,
reorder) and Design service (per-product "Design it for me" toggle, fee, help text). Shop-wide
design-service defaults live on Settings.

Every save stamps `updated_at`, which bumps `/api/public/catalog-version` — so the website can
poll cheaply and pick changes up immediately.

---

## What's inside

| Screen                | What it does                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**         | KPIs (open jobs, due in 7 days, revenue MTD, unpaid balance, rush jobs), live website-order feed, tasks due today/overdue, revenue-by-week + revenue-by-department charts, board snapshot, blank-stock watch |
| **Orders**            | Filter by status / source / payment / date + search; detail drawer with line items and specs, artwork, payment controls, stage advance, timeline, internal notes, tasks, email/SMS sends, printable job ticket, cascade delete |
| **Fulfillment board** | New → Proof → Approved → Print → Finishing → Ready → Shipped (drag or tap). Every move writes a timeline event, completes the stage task, creates the next one and logs a customer notification |
| **Customers**         | List + profile with order history, lifetime spend, timeline, notes, source badges                                                             |
| **Products**          | CRUD with image upload, pricing, min qty, turnaround, options JSON editor, blank stock and low-stock restock tasks                              |
| **Tasks**             | Today / This week / Overdue / Done, with assignees                                                                                            |
| **Messages**          | Email + SMS log with six templates (order received, proof ready, deposit reminder, ready for pickup, shipped w/ tracking, reorder follow-up)   |
| **Reports**           | Revenue by month, top products, top customers, orders by category and source, average turnaround, rush %, CSV export                          |
| **Settings**          | Shop info, tax, rush fee, turnaround, low-stock threshold, message templates, staff accounts, and the **Website integration** panel            |
| **Job ticket**        | `/#/ticket/:id` — production job ticket + packing slip, both with the Dakota Prints lockup, print-optimised for letter stock                    |

Seed data ships with the app: 15 products, 12 South Dakota / Iowa customers and ~23 orders
spread across every status, plus tasks, timeline events, messages, notifications and a
sample inbound-webhook history — so every screen is populated on first login.

---

## Run it locally

```bash
npm install          # native better-sqlite3 build — needs Node 20
cp .env.example .env # optional; sensible defaults are baked in
npm run build        # builds the React client into client/dist
npm start            # http://localhost:5000
```

Dev mode with hot reload (API on 5000, Vite on 5173 proxying `/api`):

```bash
npm run dev
```

### Admin login

| Role              | Email                     | Password        |
| ----------------- | ------------------------- | --------------- |
| Owner / admin     | `admin@dakotaprints.com`  | `ForgedOS2026!` |
| Front-counter rep | `evie@dakotaprints.com`   | `ForgedOS2026!` |

Both are shown on the login screen for demos. Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
before a real deploy.

---

## Environment variables

| Variable                | Default                        | Purpose                                                        |
| ----------------------- | ------------------------------ | -------------------------------------------------------------- |
| `PORT`                  | `5000`                         | HTTP port (Render sets `10000`)                                |
| `SESSION_SECRET`        | dev value                      | Session signing                                                |
| `DATABASE_PATH`         | `./data/dakota.db`             | SQLite file — put it on the persistent disk in production      |
| `UPLOAD_DIR`            | `./data/uploads`               | Artwork + product images, served from `/uploads`               |
| `ADMIN_EMAIL`           | `admin@dakotaprints.com`       | Seeded owner account                                           |
| `ADMIN_PASSWORD`        | `ForgedOS2026!`                | Seeded password for both accounts                              |
| `OS_WEBHOOK_TOKEN`      | `dakota-website-2026`          | Shared token the website sends as `x-webhook-token`            |
| `WEBSITE_URL`           | `https://www.dakotaprints.com` | Public site this OS backs (shown in Settings, used for the connection check) |
| `WEBSITE_ORIGINS`       | `*`                            | Comma-separated CORS allow-list for `/api/public/*`            |
| `DESIGN_NOTIFY_EMAIL`   | `orders@dakotaprints.com`      | Seeds the design-request notification address                  |
| `STRIPE_SECRET_KEY`     | —                              | Optional, see "Where the real services drop in"                |
| `RESEND_API_KEY`        | —                              | Optional                                                       |
| `TWILIO_*`              | —                              | Optional                                                       |

The client only ever calls relative `/api/...` paths, so no build-time URL configuration is
needed.

---

## Website → OS integration

Everything the website team needs is on **Settings → Website integration**: the live URLs, the
token (with a regenerate button), a copy-paste `curl` command, a full JSON payload example, a
connection check against `WEBSITE_URL`, a **Send test order** button, and a log of the last 20
inbound calls (`webhook_log` table).

### 1. Order intake (the important one)

```
POST /api/public/orders
Content-Type: application/json
x-webhook-token: <OS_WEBHOOK_TOKEN>
```

```json
{
  "customer": {
    "company": "Williston Ace Hardware",
    "contact_name": "Jamie Fox",
    "email": "jamie@example.com",
    "phone": "605-555-0143",
    "address": "905 6th Ave SE", "city": "Williston", "state": "ND", "zip": "58801"
  },
  "items": [
    { "sku": "SP-TEE-1C", "qty": 48,
      "spec": { "garment_colors": "Black", "ink_colors": "White + Red",
                "size_breakdown": { "S": 6, "M": 12, "L": 18, "XL": 12 } } },
    { "sku": "SGN-YARD", "qty": 10, "spec": { "sides": "Single-sided" } }
  ],
  "rush": false,
  "fulfillment": "ship",
  "payment_method": "Pay on invoice",
  "artwork_url": "/uploads/art-1738000000-logo.ai",
  "po_number": "PO-88213",
  "notes": "Match last spring's ink."
}
```

```bash
curl -X POST https://os.dakotaprints.com/api/public/orders \
  -H 'Content-Type: application/json' \
  -H 'x-webhook-token: dakota-website-2026' \
  -d '{"customer":{"contact_name":"Jamie Fox","email":"jamie@example.com"},
       "items":[{"sku":"SP-TEE-1C","qty":48}],"rush":false,"fulfillment":"ship"}'
```

Returns `201 { order_number, id, total, due_date, status, track_url }`.
`401` = bad token, `400` = missing `contact_name`/`email`/`items`.

On intake the OS **re-prices every line server-side** from the product catalog (the website
never controls totals), matches or creates the customer, creates the order + line items with
their specs, writes a `created` timeline event, builds the five-step task chain
(payment → proof → print → finishing → ship), raises an internal notification and logs the
"order received" email/SMS.

Per-item fields the checkout can send: `variant_label` (an active size/dimension/option),
`size_breakdown`, `design_service` + `design_brief`, and `files: [{url, filename, kind}]`
(`kind` = `artwork` | `logo` | `reference`). When a line requests a design, the OS adds the
design fee once, inserts **"Create design from customer brief"** at the front of the task chain,
tags the order and raises a design-request notification.

### 2. Catalog sync — the OS owns the catalog

```
GET /api/public/products              → { count, catalog_version, synced_at, products: [...] }
GET /api/public/products/:slug        → one product (404 when unpublished)
GET /api/public/catalog-version       → cheap { version, etag, published_count, product_count }
GET /api/public/settings              → shop profile, tax, rush fee, design-service defaults
```

Each product carries `slug`, `badge`, short + long descriptions, `images[]`, `variants[]`
(with a **resolved unit price**), `price_tiers[]`, `design_service {enabled, fee, help_text}`
and `allow_artwork_upload`. Unpublishing a product on the OS **Products** page removes it from
this feed and 404s its slug on the next request — no deploy needed.

**The full contract, with exact JSON shapes and the pricing-resolution rules, is in
[`API.md`](./API.md).** That file is the handoff document for the website.

### 3. Order tracking

```
GET /api/public/track/DP-20260728-1042
GET /api/public/track/DP-20260728-1042?email=jamie@example.com   (recommended for public pages)
```

Returns status, status label, payment status, due date, tracking number, line items and the
public timeline.

### 4. File uploads

```
POST /api/public/uploads   (multipart, token, fields "artwork" | "logo" | "reference" | "files")
→ { count, files: [{ url, filename, kind, bytes }] }

POST /api/public/artwork   (legacy single "file" field, no token)
→ { url: "/uploads/art-….ai", name, kind }
```

Post the returned file objects back in the order payload as per-item `files[]` (or the legacy
`artwork_url`). Uploaded files show as a thumbnail grid with download links on the order and are
listed on the printable job ticket.

Every call to `/api/public/*` is recorded in `webhook_log` (endpoint, HTTP status, order
number, IP, payload preview) and surfaced in Settings.

---

## Deploy

### GitHub

```bash
git init                     # already initialised in this repo
git add -A && git commit -m "Dakota Prints OS"
git remote add origin git@github.com:<you>/dakota-prints-os.git
git push -u origin main
```

### Render (blueprint included)

1. Render → **New → Blueprint**, point it at the repo. `render.yaml` provisions one Node web
   service (`npm install && npm run build`, `npm start`, health check `/api/health`) plus a
   1 GB disk mounted at `/data`.
2. Set the `sync: false` secrets in the dashboard: `ADMIN_PASSWORD`, `OS_WEBHOOK_TOKEN`
   (and Stripe / Resend / Twilio keys if you wire them up).
3. Confirm `DATABASE_PATH=/data/dakota.db` and `UPLOAD_DIR=/data/uploads` so the database and
   uploaded artwork survive deploys.
4. Deploy. First boot seeds the schema, staff accounts and demo data.

### Custom domain

1. Render service → **Settings → Custom Domains → Add** `os.dakotaprints.com`.
2. At the DNS host, add a **CNAME**: `os` → `dakota-prints-os.onrender.com` (Render shows the
   exact target). Leave `www` / apex pointed at the marketing website.
3. Render issues the TLS certificate automatically once DNS resolves.
4. Give the website team `https://os.dakotaprints.com/api/public/orders` + the token, and set
   `WEBSITE_URL=https://www.dakotaprints.com` on the service.

Sessions are held in memory, so a restart signs everyone out — expected on the starter plan.

---

## Where the real services drop in

| Need               | Drop-in point                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Email**          | `server/services.js → logMessage()` (marked `TODO(resend)`). Templates render through `server/emails.js`, which already brands the header with the lockup and the CMYK rule. Preview any template at `/api/os/email-preview?template=tpl_proof_ready`. |
| **SMS**            | Same `logMessage()` path, `channel: 'sms'` — swap the stub for Twilio's REST call using `TWILIO_*`.             |
| **Card payments**  | `server/routes/public.js` order intake marks `payment_method: "Card (demo)"` as paid. Replace with a Stripe Checkout session + a `/api/public/stripe-webhook` handler that flips `payment_status`. |
| **Shipping labels**| `advanceStatus()` in `server/services.js` generates a placeholder tracking number when a job ships — call the carrier API there. |
| **QuickBooks**     | Invoice creation belongs next to the payment controls in `routes/os.js → PATCH /orders/:id`.                    |

---

## Stack

Node 20 · Express 4 · better-sqlite3 (WAL, foreign keys on) · React 18 + Vite 5 + TypeScript ·
Tailwind 3 · Recharts · lucide-react. One service serves both the JSON API and the built
client, so there is nothing else to host.

Brand assets live in `client/public/brand/` — the pheasant + CMYK lockup appears on the login
screen, the sidebar, the job ticket, the packing slip and email headers; the mark alone is used
for the mobile top bar and favicons. Knockout versions are included for dark surfaces.

Built by **FORGED**.
