# Dakota Prints — source pricing (transcribed verbatim from client PDFs, 2026-07-30)

Source files:
- `uploaded_attachments/48f70cfacb1547e9b28a6d5e3507a928/Pricing-1.pdf` (Printing Price List)
- `uploaded_attachments/48f70cfacb1547e9b28a6d5e3507a928/New-Pricing-Sheet-for-Ticket-Books.pdf` (Stapled Ticket Books — B&W p1, Full Color p2)
- `uploaded_attachments/48f70cfacb1547e9b28a6d5e3507a928/Glued-Edge-Pricing-Sheet-Final.pdf` (Glued Edge — B&W p1, Color p2)

**Do not round, recalculate, or "fix" any price. Store exactly as listed.**

Contact block on the price list PDF is OUTDATED — client confirmed the site/OS values are correct:
201 2nd Ave W, Williston, ND 58801 · 701-713-4400. Ignore the PDF's "124 2nd Ave W / 701.572.4920".
The PDF also shows office@dakotaprints.com — do not change any existing email settings based on it.

---

## 1. Per-square-foot products (pricing mode: `sqft`)

### Banners
- 13oz material: **$5.50 / sq ft**
- 18oz material: **$6.50 / sq ft**
- Double-sided is DOUBLE the price (x2 multiplier)
- **Double-sided can ONLY be printed on 18oz** — must be enforced in UI and server-side validation

### Large Format Poster Printing
- **$4.50 / sq ft**, single-sided only

Notes for both: customer enters width x height in inches; sq ft = (w x h) / 144. Round sq ft up to
2 decimals for display, and price to the cent. No stated minimum charge in the source — set a
minimum of 1 sq ft (editable in the OS) and label it clearly as a shop-set minimum, not vendor pricing.

---

## 2. Flat-price-per-option products (pricing mode: `flat_option`)

### Business Cards
| Option | Price |
|---|---|
| 250 cards | $85.00 |
| 500 cards | $95.00 |

### Engineering Drawings (price is PER SHEET)
| Size | Price each |
|---|---|
| 11" x 17" | $1.25 |
| 24" x 36" | $4.50 |
| 40" x 32" | $5.00 |

---

## 3. Matrix products (pricing mode: `matrix`)

Four matrices. Axes for all four are identical:

- **Axis 1 — Finished size:** `8.5" x 11"`, `5.5" x 8.5"`, `8.5" x 14"`
- **Axis 2 — Parts:** `2 Parts`, `3 Parts`, `4 Parts`
- **Axis 3 — Quantity (books / forms):**
  | Label | Books | Forms |
  |---|---|---|
  | EACH | 1 | 50 |
  | 5 books | 5 | 250 |
  | 10 books | 10 | 500 |
  | 20 books | 20 | 1,000 |
  | 30 books | 30 | 1,500 |
  | 40 books | 40 | 2,000 |
  | 50 books | 50 | 2,500 |

  50 forms per book. Price shown is the TOTAL for that many books, not a unit price.
  Front end should label these like `10 books (500 forms) — $245.90`.

Matrix CSV files (columns: `size,parts,qty_label,books,forms,price`) are in this folder:
- `stapled-ticket-books-bw.csv`
- `stapled-ticket-books-color.csv`
- `glued-edge-bw.csv`
- `glued-edge-color.csv`

Full-color ticket book sheet carries this note — surface it as product fine print:
"The add-on guide is already included in every displayed price."

Both glued-edge pages footer: "All prices shown in USD. Source prices preserved exactly."

Typo in source: page 2 of the glued-edge PDF is titled "Glues Edge Pricing Sheet". Use "Glued Edge".

---

## Product naming suggestion
- `Stapled Ticket Books — Black & White`
- `Stapled Ticket Books — Full Color`
- `Glued Edge Books — Black & White`
- `Glued Edge Books — Full Color`
- `Vinyl Banners`
- `Large Format Posters`
- `Business Cards`
- `Engineering Drawings`

Alternatively bind color mode as a 4th axis on two products (Stapled / Glued Edge) — see the OS
spec discussion; either is acceptable as long as the resolved price matches the sheets exactly.
