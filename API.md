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
| POST   | `/api/public/quote`           | none  | **NEW** — server-priced quote for any pricing mode |
| POST   | `/api/public/uploads`         | token | Multi-file customer upload       |
| POST   | `/api/public/artwork`         | none  | Legacy single-file upload        |
| POST   | `/api/public/orders`          | token | Order intake (server re-prices)  |
| GET    | `/api/public/track/:orderNumber` | none | Customer order status          |

### Pricing modes (new)

Every product now has a `pricing_mode`: `tiered_unit` (original apparel/quantity-tier
model, unchanged), `flat_option` (pick one flat-priced option, e.g. a card
quantity or a sheet size), `sqft` (width × height → square feet × rate, e.g.
banners/posters), or `matrix` (pick one value per axis — size, parts, quantity —
and look up the exact cell price, e.g. ticket books). See §1a for the new
`pricing` sub-object shape per mode and §8 for `POST /api/public/quote`, the
endpoint that resolves all four modes server-side.

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
      "pricing_mode": "tiered_unit",
      "unit_label": null,
      "fine_print": null,
      "pricing": null,
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
- `pricing_mode` is one of `tiered_unit` \| `flat_option` \| `sqft` \| `matrix`.
  `tiered_unit` products keep working exactly as documented above (`variants` +
  `price_tiers`) — nothing about them changed. For the other three modes,
  `variants`/`price_tiers` are empty arrays and pricing instead lives in the new
  `pricing` object (§1a). `unit_label` is a display string (e.g. `"per sheet"`,
  `"per sq ft"`) or `null` for tiered_unit. `fine_print` is an optional string to
  render under the price (e.g. the full-color ticket-book add-on-guide note) or
  `null`.

### 1a. The `pricing` object (flat_option / sqft / matrix)

`pricing` is `null` for `tiered_unit` products. Otherwise its shape depends on
`pricing_mode`. This is everything the storefront needs to render the picker
UI — it never has to guess at options, materials or axis values.

**`flat_option`** (e.g. Business Cards, Engineering Drawings) — real payload from `GET /api/public/products/business-cards`:

```json
{
  "options": [
    { "id": 1, "label": "250 cards", "price": 85, "sku_suffix": "250", "sort_order": 0 },
    { "id": 2, "label": "500 cards", "price": 95, "sku_suffix": "500", "sort_order": 1 }
  ],
  "unit_label": null
}
```

(Engineering Drawings' `pricing.unit_label` is `"per sheet"` — the same value
as the top-level `unit_label` field on the product.)

Render a single dropdown/radio list of `options[].label` → `options[].price`.
Send the chosen `id` back as `selection.option_id`. Quantity (`qty`) is a
separate multiplier the customer also picks (e.g. "3 sheets of 24x36") —
`line_total = option.price * qty`. This is how Engineering Drawings' per-sheet
pricing works: the option price is per unit, `qty` is how many units.

**`sqft`** (e.g. Vinyl Banners, Large Format Posters):

Real payload from `GET /api/public/products/vinyl-banners`:

```json
{
  "rate_per_sqft": null,
  "minimum_sqft": 1,
  "double_sided_multiplier": 2,
  "materials": [
    { "id": 1, "label": "13oz", "rate_per_sqft": 5.5, "allows_double_sided": false, "sort_order": 0 },
    { "id": 2, "label": "18oz", "rate_per_sqft": 6.5, "allows_double_sided": true, "sort_order": 1 }
  ]
}
```

(Large Format Posters has no `materials` and a non-null top-level
`rate_per_sqft: 4.5` instead — both shapes coexist under the same `sqft` mode.)

If `materials` is a non-empty array, the customer must pick one
(`selection.material_id`) and that material's own `rate_per_sqft` /
`allows_double_sided` govern the price — the top-level `rate_per_sqft` is
unused. If `materials` is empty (posters), the top-level `rate_per_sqft`
applies directly and there's no material picker. See §9 for the exact
client-side banner-calculator formula.

**`matrix`** (e.g. all four ticket-book products):

Real payload (truncated) from `GET /api/public/products/stapled-ticket-books-black-white`:

```json
{
  "cell_count": 63,
  "axes": [
    {
      "id": 1, "name": "Finished size", "axis_order": 0,
      "values": [
        { "id": 1, "value": "8.5\" x 11\"", "meta": null, "value_order": 0 },
        { "id": 2, "value": "5.5\" x 8.5\"", "meta": null, "value_order": 1 },
        { "id": 3, "value": "8.5\" x 14\"", "meta": null, "value_order": 2 }
      ]
    },
    {
      "id": 2, "name": "Parts", "axis_order": 1,
      "values": [
        { "id": 4, "value": "2 Parts", "meta": null, "value_order": 0 },
        { "id": 5, "value": "3 Parts", "meta": null, "value_order": 1 },
        { "id": 6, "value": "4 Parts", "meta": null, "value_order": 2 }
      ]
    },
    {
      "id": 3, "name": "Quantity", "axis_order": 2,
      "values": [
        { "id": 7, "value": "EACH", "meta": { "books": 1, "forms": 50 }, "value_order": 0 },
        { "id": 8, "value": "5 books", "meta": { "books": 5, "forms": 250 }, "value_order": 1 }
      ]
    }
  ]
}
```

`axes` is ordered by `axis_order` ascending (already sorted in the response) —
render one dropdown per axis, left to right in that order; each axis's
`values[]` is likewise pre-sorted by `value_order`. Most axis values have
`meta: null`; the Quantity axis's values carry `meta.books`/`meta.forms` so you
can show "5 books · 250 forms" instead of a bare label. The customer must
choose one value per axis; send all chosen ids, **in axis order**, as
`selection.axis_value_ids = [size_id, parts_id, qty_id]`. The price returned
is the **total for that exact cell**, not a per-unit price — `qty` (default 1)
is a separate multiplier on top of the cell price (e.g. "2 identical
ticket-book jobs"). Full-color ticket books additionally set `fine_print` on
the product to `"The add-on guide is already included in every displayed
price."` — render it under the price. See §9 for cascading-dropdown guidance.

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

## 5. `POST /api/public/quote`  *(no token — read-style, but always server-priced)*

The **single endpoint that resolves a price for any pricing mode**, using the
exact same resolver (`priceLine` in `server/pricing.js`) the OS itself uses and
that `/orders` calls at checkout time. Use it to show a live price as the
customer fills in the picker/calculator, *before* they submit an order. The
client-side price shown here is never trusted at order time — `/orders`
re-resolves independently from the same `selection` shape.

Request:

```json
{ "slug": "business-cards", "qty": 1, "selection": { "option_id": 1 } }
```

`slug` or `sku` identifies the product (404 if not found, unpublished, or
inactive). `qty` defaults to 1. `selection` shape depends on `pricing_mode`:

| pricing_mode | `selection` shape | Notes |
| --- | --- | --- |
| `tiered_unit` | `{}` | `qty` drives the tier. To price a specific size/variant, pass `variant_label` **at the top level of the request body** (sibling of `slug`/`qty`/`selection`, not inside `selection`) — e.g. `{ "slug": "...", "qty": 48, "variant_label": "2XL" }`. This mirrors the existing `/orders` item shape. |
| `flat_option` | `{ "option_id": 1 }` | `option_id` from `pricing.options[].id`. |
| `sqft` | `{ "material_id": 2, "width_in": 48, "height_in": 96, "double_sided": false }` | `material_id` omitted/ignored if the product has no `materials` (uses `pricing.rate_per_sqft`). |
| `matrix` | `{ "axis_value_ids": [1, 4, 7] }` | Must include exactly one id per axis, **in `pricing.axes` order**. |

Success response `200` (shape is identical regardless of mode):

```json
{
  "sku": "BC-FLAT",
  "slug": "business-cards",
  "name": "Business Cards",
  "pricing_mode": "flat_option",
  "unit_price": 85,
  "line_total": 85,
  "meta": {
    "pricing_mode": "flat_option",
    "option_id": 1,
    "option_label": "250 cards",
    "unit_label": null,
    "qty": 1
  }
}
```

`meta` varies by mode and is meant for debugging/receipts, not required for
rendering (you already know the selection you sent). For `sqft` it includes
`exact_sqft`, `billed_sqft`, `minimum_sqft`, `double_sided`, `rate_per_sqft`,
`qty`. For `matrix` it includes `selection` (ordered `{axis, value, meta}`),
`cell_key`, `cell_price`, `qty`.

Error response (any 4xx — status varies, default `400`):

```json
{ "error": "13oz does not support double-sided printing.", "code": "double_sided_not_allowed" }
```

All `code` values you may need to handle in the UI (e.g. disable a control,
show an inline message):

| `code` | Meaning | Typical cause |
| --- | --- | --- |
| `unknown_option` | `flat_option` id not found / inactive | Stale cached options list |
| `unknown_material` | `sqft` `material_id` not found / inactive | Stale cached materials list |
| `invalid_dimensions` | `sqft` width/height missing or ≤ 0 | Empty or bad calculator input |
| `no_rate` | `sqft` product has no materials **and** no `rate_per_sqft` set | Data issue — report to Frank |
| `double_sided_not_allowed` | `sqft` `double_sided: true` on a material/product that disallows it | e.g. 13oz banner |
| `no_axes` | `matrix` product has zero configured axes | Data issue — report to Frank |
| `incomplete_selection` | `matrix` `axis_value_ids.length` ≠ number of axes | Customer hasn't finished all dropdowns yet |
| `unknown_axis_value` | one of `axis_value_ids` doesn't belong to its axis (or doesn't exist) | Stale cached axis values, or a value from a different product |
| `unknown_axis_combination` | all ids are valid individually but no matrix cell exists for that exact combination | Sparse matrix / bad combination — disable that combination client-side once known |
| `unknown_variant` | `tiered_unit` `variant_id` given but not found | Legacy path, unrelated to the four new modes |

```bash
curl -X POST $OS/api/public/quote -H 'Content-Type: application/json' \
  -d '{"slug":"vinyl-banners","qty":1,"selection":{"material_id":2,"width_in":48,"height_in":96,"double_sided":true}}'
```

## 6. `POST /api/public/uploads`  *(token)*

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

## 7. `POST /api/public/orders`  *(token)*

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
| `variant_label` (alias `variant`) | string | **`tiered_unit` products only.** Must match an **active** variant label, case-insensitive. Ignored if unknown. |
| `selection` | object | **`flat_option` / `sqft` / `matrix` products only.** Same shape as `POST /api/public/quote`'s `selection` (§5 above) — `{option_id}`, `{material_id,width_in,height_in,double_sided}`, or `{axis_value_ids}` respectively. The server re-resolves the price from this on every order; a bad/incomplete selection rejects the **whole request** with the same `{error, code}` shape `/quote` uses (see the error-code table in §5), so validate with `/quote` first and only submit the order once `/quote` succeeds. |
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

This section describes `tiered_unit` pricing, unchanged from before. For
`flat_option` / `sqft` / `matrix` products, steps 1–2 below are replaced by the
shared resolver in `server/pricing.js` (documented in §1a and §5); steps 3–9
(design service, rush, shipping, tax, due date) apply identically regardless
of pricing mode — `unit`/`line_total` from the mode-specific resolver just feed
into the same subtotal.

1. **Tier price** *(tiered_unit only)*: `base(qty)` = the `unit_price` of the
   highest `price_tier` whose `min_qty <= qty`; if no tier matches,
   `product.base_price`.
2. **Variant** *(tiered_unit only)*:
   - variant has an absolute `price` → `unit = price` (**tiers ignored**);
   - variant has `price = null` and an `upcharge` → `unit = base(qty) + upcharge`;
   - no variant → `unit = base(qty)`.
3. `line_total = round2(unit * qty)` (`tiered_unit`) or the mode-specific total
   from §1a/§5 (`flat_option`/`sqft`/`matrix`).
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

## 8. `GET /api/public/track/:orderNumber`

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

## 9. Client-side rendering rules: cascading dropdowns + banner calculator

### Matrix products (cascading dropdowns)

1. Render one dropdown per entry in `pricing.axes`, in array order (already
   sorted by `axis_order`). Each dropdown's options come from that axis's
   `values[]` (already sorted by `value_order`) — label with `value` (and, if
   present, enrich with `meta`, e.g. "5 books · 250 forms" from
   `meta.books`/`meta.forms`).
2. Axes must be **selected in order** — don't let the customer touch axis 2
   before axis 1 has a value; disable/grey out later dropdowns until earlier
   ones are chosen (this mirrors how the OS's own matrix editor works and
   keeps the UX predictable even though the current 4 products' axes are not
   actually interdependent — every combination of the 3 sizes × 3 parts × 7
   quantities is a valid, priced cell for all four book products today).
3. Once all axes have a value, call `POST /api/public/quote` with
   `selection.axis_value_ids` in axis order and show `line_total`. Do this on
   every change so the price updates live.
4. **Do not assume every combination is priced.** Even though today's 4
   products are fully dense (63/63 cells), the schema allows sparse matrices.
   If `/quote` returns `code: "unknown_axis_combination"`, show "that combination
   isn't available" rather than a stale/blank price — never fall back to a
   client-computed guess.
5. Treat axis value ids as opaque and always re-fetch
   `GET /api/public/products/:slug` on catalog-version change (§3) — ids are
   stable for a given axis value's lifetime but a re-import can add/remove
   values, so don't hardcode them.

### Banner / sqft calculator

For `sqft` products (`vinyl-banners`, `large-format-posters`):

1. If `pricing.materials` is non-empty, render a material picker (13oz/18oz
   etc.) and only enable the "double-sided" checkbox when the selected
   material's `allows_double_sided` is `true` — hide/disable it otherwise so
   the customer never submits a combination the server will reject.
2. Collect `width_in` and `height_in` (inches) from the customer.
3. Compute for display (the server recomputes this independently — never
   trust the client number for checkout):
   ```
   exact_sqft  = (width_in * height_in) / 144
   billed_sqft = max(exact_sqft, minimum_sqft)      // minimum_sqft from pricing (or the material's, if you expose per-material minimums later)
   rate        = selected_material ? selected_material.rate_per_sqft : pricing.rate_per_sqft
   multiplier  = double_sided ? pricing.double_sided_multiplier : 1
   line_total  = round_to_cent(billed_sqft * rate * multiplier * qty)
   ```
4. Reject/disable submission client-side for `width_in <= 0` or
   `height_in <= 0` (the server also rejects these with `invalid_dimensions`,
   but catching it client-side gives a faster/friendlier error).
5. Call `POST /api/public/quote` with `{material_id, width_in, height_in,
   double_sided}` to get the authoritative `line_total` (and `meta.exact_sqft`
   / `meta.billed_sqft` if you want to show "billed at 1 sq ft minimum" style
   messaging when the floor kicks in).

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
