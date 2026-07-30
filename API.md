# Dakota Prints OS — Public API contract

The OS at `dakota-prints-admin-os` is the **single source of truth** for everything
dakotaprints.com sells. The website never hardcodes products, prices, sizes or
images: it reads them from these endpoints. Frank publishes/unpublishes and
re-prices from the OS **Products** page and the site changes on the next request —
no deploy.

- Base URL: `OS_API_URL` (local dev `http://localhost:5000`, Render `https://<service>.onrender.com`)
- All public routes live under `/api/public/*`
- Content type: JSON, UTF-8. Money is a **number** in dollars (2 dp), never a string.
- Booleans are real JSON booleans in public payloads (`true`/`false`).
- Read endpoints need **no token**. Write endpoints (`/orders`, `/uploads`) require
  header `x-webhook-token: <OS_WEBHOOK_TOKEN>` (dev default `dakota-website-2026`,
  visible in OS → Settings → Website integration).
- CORS: `Access-Control-Allow-Origin` is driven by `WEBSITE_ORIGINS`
  (comma-separated allow-list; `*` in dev). `OPTIONS` preflight returns 204.

| Method | Path                          | Auth  | Purpose                          |
| ------ | ----------------------------- | ----- | -------------------------------- |
| GET    | `/api/public/products`        | none  | Published catalog                |
| GET    | `/api/public/products/:slug`  | none  | One product (404 if unpublished) |
| GET    | `/api/public/catalog-version` | none  | Cheap cache key / ETag           |
| GET    | `/api/public/settings`        | none  | Shop profile, tax, design defaults |
| POST   | `/api/public/uploads`         | token | Multi-file customer upload       |
| POST   | `/api/public/artwork`         | none  | Legacy single-file upload        |
| POST   | `/api/public/orders`          | token | Order intake (server re-prices)  |
| GET    | `/api/public/track/:orderNumber` | none | Customer order status          |

---

## 1. `GET /api/public/products`

Only products with `published = 1 AND active = 1`, sorted by `website_order`
ascending (then name). Optional query params: `?category=Apparel`, `?q=tee`.

Response headers: `ETag: W/"cat-<version>"`, `Cache-Control: public, max-age=30`.

```json
{
  "count": 15,
  "catalog_version": "1lk3pp8",
  "updated_at": "2026-07-30 14:54:29",
  "synced_at": "2026-07-30T14:55:03.246Z",
  "products": [
    {
      "id": 1,
      "slug": "screen-printed-tee-1-color",
      "sku": "SP-TEE-1C",
      "name": "Screen-Printed Tee — 1 Color",
      "category": "Apparel",
      "badge": "Best seller",
      "short_description": "One-color plastisol print on a heavy cotton tee…",
      "long_description": "Gildan 5000 heavyweight cotton, one screen…",
      "base_price": 8.5,
      "unit": "per shirt",
      "min_qty": 24,
      "turnaround_days": 7,
      "website_order": 1,
      "images": [
        {
          "url": "https://os.example.com/brand/products/screenprint-tee.jpg",
          "path": "/brand/products/screenprint-tee.jpg",
          "alt": "Screen-printed tee on the press",
          "is_primary": true
        }
      ],
      "variants": [
        { "label": "S",   "kind": "size", "unit_price": 8.5,  "price": null, "upcharge": 0, "sku_suffix": "S",   "active": true, "stock": null },
        { "label": "2XL", "kind": "size", "unit_price": 10.5, "price": null, "upcharge": 2, "sku_suffix": "2XL", "active": true, "stock": 40 }
      ],
      "price_tiers": [
        { "min_qty": 24, "unit_price": 8.5 },
        { "min_qty": 48, "unit_price": 7.75 },
        { "min_qty": 96, "unit_price": 6.95 }
      ],
      "design_service": {
        "enabled": true,
        "fee": 45,
        "help_text": "Tell us what you need and our art department will build it…"
      },
      "allow_artwork_upload": true,
      "options": {
        "garment_colors": ["White", "Black", "Navy"],
        "ink_colors": ["White", "Black", "Red"],
        "placements": ["Front", "Back", "Left chest"]
      },
      "stock": 480,
      "updated_at": "2026-07-30 14:54:29"
    }
  ]
}
```

Field notes:

- `slug` is unique and stable — use it for product URLs (`/shop/<slug>`).
- `images[].url` is **absolute** (origin of the request) so it can be dropped
  straight into `<img src>`. `images[].path` is the OS-relative original if you
  prefer to proxy. Exactly one image has `is_primary: true` when any image exists.
- `variants[].unit_price` is the **resolved price at `min_qty`** — a convenience
  for rendering "from $X" and size tables. For a real quantity, apply the rules in
  §6 (or just send the order and trust the server total).
- `variants[].kind` is `size` (apparel), `dimension` (signage/banner) or `option`
  (add-ons like "Two sides engraved"). Inactive variants are omitted.
- `price_tiers` is ascending by `min_qty`; `unit_price` is non-increasing.
- `options` is the legacy free-form JSON (garment colors, ink colors, placements).
  Sizes/dimensions now live in `variants`; `options.sizes` may still exist on
  older records — prefer `variants`.
- `stock` is blank-stock on hand or `null` for made-to-order. Informational only;
  the OS never blocks an order on stock.

## 2. `GET /api/public/products/:slug`

Returns a single product object (the same shape as one element of `products[]`).
`:slug` also accepts a SKU for backward compatibility. Returns
`404 {"error":"Product not found or not published"}` when the product is
unpublished, archived or unknown — so unpublishing instantly 404s its page.

## 3. `GET /api/public/catalog-version`

```json
{
  "version": "1lk3pp8",
  "etag": "W/\"cat-1lk3pp8\"",
  "revision": 23,
  "published_count": 15,
  "product_count": 15,
  "updated_at": "2026-07-30 14:54:29",
  "checked_at": "2026-07-30T14:55:03.246Z"
}
```

`version` is a base-36 hash of `max(updated_at)` + published count + total product
count + image count + variant count + `revision`. `revision` is a monotonic
counter bumped by **every** catalog write (publish toggle, price edit, image add,
variant or tier change, reorder, duplicate, delete) — it exists because
`updated_at` only has one-second resolution, so two edits inside the same second
would otherwise produce an identical cache key. Treat `version` as opaque; treat
`revision` as strictly increasing if you want to detect "is my copy stale?".

Poll this (it is a single cheap query, ~60 s is plenty) and refetch the catalog
only when `version` changes.

## 4. `GET /api/public/settings`

```json
{
  "shop_name": "Dakota Prints",
  "shop_tagline": "Screen print, embroidery, signs & business print — Williston, North Dakota",
  "shop_phone": "701-713-4400",
  "shop_email": "orders@dakotaprints.com",
  "shop_address": "201 2nd Ave W, Williston, ND 58801",
  "tax_rate": 4.5,
  "rush_fee_pct": 20,
  "default_turnaround": 7,
  "free_shipping_threshold": 500,
  "flat_shipping": 24.5,
  "design_service": { "default_fee": 45, "help_text": "Tell us what you need…", "enabled_default": true }
}
```

`tax_rate` and `rush_fee_pct` are **percentages** (4.5 = 4.5%). All of these are
editable in OS → Settings, so read them rather than hardcoding shop details,
tax or shipping thresholds on the site.

## 5. `POST /api/public/uploads`  *(token)*

`multipart/form-data`. Field names `artwork`, `logo`, `reference` set the file
`kind`; a generic `files` field defaults to `artwork` (override with a `kind`
form field). Up to 10 files, 24 MB each.

```bash
curl -X POST $OS/api/public/uploads \
  -H "x-webhook-token: $TOKEN" \
  -F 'artwork=@logo.ai' -F 'reference=@moodboard.jpg'
```

```json
{
  "count": 2,
  "files": [
    { "url": "/uploads/cust-1785423580566-a1b2c-logo.ai", "filename": "logo.ai", "kind": "artwork", "bytes": 812344 },
    { "url": "/uploads/cust-1785423580671-c3d4e-moodboard.jpg", "filename": "moodboard.jpg", "kind": "reference", "bytes": 240119 }
  ]
}
```

Pass these `{url, filename, kind}` objects back in the order payload. URLs are
OS-relative and served from `/uploads/...` on the OS origin.

`POST /api/public/artwork` (single `file` field) still exists and returns
`{ url, name, kind }`.

## 6. `POST /api/public/orders`  *(token)*

The website **never sets prices**. It sends SKU + qty + choices; the OS re-prices
every line and returns the authoritative totals. If your cart total disagrees,
display the server total.

Request:

```json
{
  "customer": {
    "company": "Williston Ace Hardware",
    "contact_name": "Jamie Fox",
    "email": "jamie@example.com",
    "phone": "701-555-0143",
    "address": "905 6th Ave SE", "city": "Williston", "state": "ND", "zip": "58801"
  },
  "items": [
    {
      "sku": "SP-TEE-1C",
      "qty": 48,
      "variant_label": "2XL",
      "size_breakdown": { "S": 6, "M": 12, "L": 18, "2XL": 12 },
      "design_service": true,
      "design_brief": "Bold rig silhouette, shop name arched over it, white + red ink.",
      "files": [
        { "url": "/uploads/cust-…-logo.png", "filename": "logo.png", "kind": "logo" },
        { "url": "/uploads/cust-…-ref.jpg", "filename": "ref.jpg", "kind": "reference" }
      ],
      "spec": { "garment_colors": "Black", "ink_colors": "White + Red", "placements": "Front" }
    },
    { "sku": "SGN-YARD", "qty": 25, "variant_label": "24x36" }
  ],
  "rush": false,
  "fulfillment": "ship",
  "payment_method": "Pay on invoice",
  "po_number": "PO-88213",
  "notes": "Match last spring's ink.",
  "files": [{ "url": "/uploads/cust-…-po.pdf", "filename": "po.pdf", "kind": "reference" }],
  "source_label": "dakotaprints.com checkout"
}
```

Item fields:

| Field | Type | Notes |
| ----- | ---- | ----- |
| `sku` or `slug` | string | Either identifies the product. Unknown → line is priced from `unit_price` if sent, else 0. |
| `qty` | int ≥ 1 | Required. |
| `variant_label` (alias `variant`) | string | Must match an **active** variant label, case-insensitive. Ignored if unknown. |
| `size_breakdown` | object | Free-form `{size: count}`; stored on the line spec and printed on the job ticket. Does **not** change pricing — `qty` does. |
| `design_service` | bool | Honoured only when the product has `design_service.enabled`. |
| `design_brief` | string | Free text; shown on the order and the job ticket. |
| `files` | array | `{url, filename, kind}` — `kind` ∈ `artwork` \| `logo` \| `reference` (anything else stored as `artwork`). |
| `artwork_url` | string | Legacy single-file field; still accepted and treated as an `artwork` file. |
| `spec` | object | Free-form choices (colors, ink, placement, sides). Rendered verbatim in the OS. |

Order fields: `rush` (bool), `fulfillment` `ship`\|`pickup`, `payment_method`
(`Pay on invoice` \| `50% deposit` \| `Card (demo)` — the last two set
`payment_status` to `deposit`/`paid`), `po_number`, `notes`, order-level `files[]`
(attached to the first line), `source_label`.

### Pricing resolution rules (authoritative)

1. **Tier price**: `base(qty)` = the `unit_price` of the highest `price_tier` whose
   `min_qty <= qty`; if no tier matches, `product.base_price`.
2. **Variant**:
   - variant has an absolute `price` → `unit = price` (**tiers ignored**);
   - variant has `price = null` and an `upcharge` → `unit = base(qty) + upcharge`;
   - no variant → `unit = base(qty)`.
3. `line_total = round2(unit * qty)`.
4. **Design service**: when the line requests it, `product.design_service_fee`
   (falling back to the shop default) is added **once per line** and appears in
   the OS as its own visible line item `Design service — <product>`.
5. **Rush**: `rush_fee = round2(subtotal * rush_fee_pct/100)`.
6. **Shipping**: `pickup` → 0; otherwise 0 when `subtotal >= 500`, else 24.50.
7. **Tax**: `round2((subtotal + rush_fee) * tax_rate/100)` — shipping is not taxed.
8. `total = subtotal + rush_fee + shipping + tax`.
9. **Due date**: `max(product.turnaround_days)` (halved and rounded up when rush)
   `+ 2 days` when any line requests a design.

`min_qty` is **not** enforced server-side — validate it on the website (the OS
Products page shows a "below minimum" warning in its calculator).

Response `201`:

```json
{
  "order_number": "DP-20260730-9553",
  "id": 24,
  "status": "new",
  "due_date": "2026-08-05",
  "subtotal": 1013,
  "design_total": 45,
  "rush_fee": 202.6,
  "shipping": 0,
  "tax": 54.7,
  "total": 1270.3,
  "design_service": true,
  "items": [
    { "name": "Screen-Printed Tee — 1 Color", "sku": "SP-TEE-1C", "qty": 48, "variant_label": "2XL",
      "unit_price": 9.75, "line_total": 468, "design_service": true, "design_fee": 45 },
    { "name": "Coroplast Yard Sign 18x24", "sku": "SGN-YARD", "qty": 25, "variant_label": "24x36",
      "unit_price": 20, "line_total": 500, "design_service": false, "design_fee": 0 }
  ],
  "track_url": "/api/public/track/DP-20260730-9553"
}
```

Errors: `401 {"error":"Invalid webhook token"}`,
`400 {"error":"contact_name and email are required"}`,
`400 {"error":"At least one line item is required"}`.

What the OS does on intake: matches or creates the customer, writes the order,
line items and file references, opens the standard task chain, and — when a
design was requested — inserts **"Create design from customer brief"** at the
front of that chain, tags the order (`design_service = 1`, visible as a *Design
requested* chip), logs a `design` timeline event with the brief and raises a
`design_request` notification to `DESIGN_NOTIFY_EMAIL`. A branded confirmation
email (and SMS when a phone is present) is logged for the customer.

## 7. `GET /api/public/track/:orderNumber`

Add `?email=` to require an email match (recommended for a public status page).
The legacy form `GET /api/public/track?order_number=…&email=…` still works.

```json
{
  "order_number": "DP-20260730-9553",
  "status": "print",
  "status_label": "Print",
  "payment_status": "unpaid",
  "fulfillment": "ship",
  "due_date": "2026-08-05",
  "rush": 0,
  "design_service": true,
  "total": 1270.3,
  "tracking_number": null,
  "created_at": "2026-07-30 14:58:08",
  "items": [
    { "id": 37, "name": "Screen-Printed Tee — 1 Color — 2XL", "qty": 48, "line_total": 468,
      "variant_label": "2XL", "design_service": 1, "spec": { "variant": "2XL", "size_breakdown": { "2XL": 48 } },
      "files": [{ "url": "/uploads/cust-…-logo.png", "filename": "logo.png", "kind": "logo" }] }
  ],
  "events": [{ "type": "created", "message": "Order received from dakotaprints.com checkout", "created_at": "…" }]
}
```

---

## Caching + sync recipe for the website

1. On build/ISR revalidate: `GET /api/public/products` and render from it.
2. At runtime (or every 60 s): `GET /api/public/catalog-version`; if `version`
   changed, refetch. Honour the `ETag` with `If-None-Match` for a 304-cheap poll.
3. Never cache a product page longer than the version poll interval — an
   unpublish must take a visitor to a 404/redirect quickly.
4. Send prices you rendered for display only; the order response is the truth.

## Logging + observability

Every public call is written to `webhook_log` with endpoint, status, order number,
caller IP and a payload preview, and shown in OS → Settings → Website integration
("Last 20 inbound calls"). Use it to debug a failing integration without server
access.

## Environment variables that affect this contract

| Var | Effect |
| --- | ------ |
| `OS_WEBHOOK_TOKEN` | Required value of `x-webhook-token` for `/orders` and `/uploads`. |
| `WEBSITE_ORIGINS` | Comma-separated CORS allow-list for `/api/public/*`. Default `*`. |
| `WEBSITE_URL` | Storefront URL used by the OS "check connection" tool and links. |
| `DESIGN_NOTIFY_EMAIL` | Seeds the design-request notification address. |
| `UPLOAD_DIR` | Where uploaded files land; served at `/uploads/*`. |
