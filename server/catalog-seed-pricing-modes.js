// One-time seed of the 8 real Dakota Prints products that use the new pricing
// modes (matrix / sqft / flat_option). Guarded by `catalog_pricing_modes_v1`
// so it only ever runs once and never stomps admin edits made after go-live.
// Source of truth: /pricing-source/dakota-prints-pricing-source.md + the 4 CSVs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSetting, setSetting, uniqueSlug } from './db.js';
import { parseCsv } from './pricing-import.js';
import { cellKeyFrom } from './pricing.js';
import { money } from './catalog.js';

const IMG = (n) => `/brand/products/${n}.jpg`;
const IMG_PNG = (n) => `/brand/products/${n}.png`;

// The 4 matrix CSVs share identical axes: Finished size / Parts / Quantity.
// CSV columns: size,parts,qty_label,books,forms,price
const QTY_META = { EACH: { books: 1, forms: 50 } }; // rest are derived from the row's own books/forms

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadMatrixCsv(file) {
  // Bundled with the repo so production boots do not depend on any path outside
  // the deployed tree. Dev checkouts may still keep the sheets one level up.
  const candidates = [
    path.join(HERE, 'seed-data', 'pricing-source', file),
    path.resolve(process.cwd(), 'server', 'seed-data', 'pricing-source', file),
    path.resolve(process.cwd(), '..', 'pricing-source', file),
  ];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) throw new Error(`Pricing seed CSV not found: ${file} (looked in ${candidates.join(', ')})`);
  const text = fs.readFileSync(p, 'utf8');
  const { records } = parseCsv(text);
  return records;
}

/** Build axis defs (with ordered unique values) + cell rows from the 63 CSV records. */
function buildMatrixFromRecords(records) {
  const sizeOrder = [];
  const partsOrder = [];
  const qtyOrder = [];
  const qtyMeta = new Map();
  for (const r of records) {
    if (!sizeOrder.includes(r.size)) sizeOrder.push(r.size);
    if (!partsOrder.includes(r.parts)) partsOrder.push(r.parts);
    if (!qtyOrder.includes(r.qty_label)) { qtyOrder.push(r.qty_label); qtyMeta.set(r.qty_label, { books: Number(r.books), forms: Number(r.forms) }); }
  }
  const axes = [
    { name: 'Finished size', values: sizeOrder.map((v) => ({ value: v, meta: null })) },
    { name: 'Parts', values: partsOrder.map((v) => ({ value: v, meta: null })) },
    { name: 'Quantity', values: qtyOrder.map((v) => ({ value: v, meta: qtyMeta.get(v) })) },
  ];
  const indexOf = (arr, v) => arr.indexOf(v);
  const cells = records.map((r) => ({
    values: [indexOf(sizeOrder, r.size), indexOf(partsOrder, r.parts), indexOf(qtyOrder, r.qty_label)],
    price: Number(r.price),
  }));
  return { axes, cells };
}

function insertMatrixProduct(productId, axesDefs, cells) {
  const insAxis = db.prepare('INSERT INTO product_axes (product_id,name,axis_order) VALUES (?,?,?)');
  const insVal = db.prepare('INSERT INTO product_axis_values (axis_id,value,meta_json,value_order) VALUES (?,?,?,?)');
  const insCell = db.prepare('INSERT INTO product_matrix_cells (product_id,cell_key,price) VALUES (?,?,?)');
  const axisValueIds = [];
  axesDefs.forEach((a, ai) => {
    const axisId = insAxis.run(productId, a.name, ai).lastInsertRowid;
    axisValueIds[ai] = a.values.map((v, vi) => insVal.run(axisId, v.value, v.meta ? JSON.stringify(v.meta) : null, vi).lastInsertRowid);
  });
  for (const c of cells) {
    const ids = c.values.map((vi, ai) => axisValueIds[ai][vi]);
    insCell.run(productId, cellKeyFrom(ids), money(c.price));
  }
}

function nextWebsiteOrder() {
  return db.prepare('SELECT COALESCE(MAX(website_order),0)+1 n FROM products').get().n;
}

function insertProduct(row) {
  const slug = uniqueSlug(row.name);
  const r = db.prepare(`INSERT INTO products (
      sku,name,category,description,short_description,long_description,badge,base_price,unit,min_qty,
      turnaround_days,stock,active,published,design_service_enabled,design_service_fee,design_service_help,
      allow_artwork_upload,website_order,slug,image_url,options_json,pricing_mode,unit_label,rate_per_sqft,
      minimum_sqft,double_sided_multiplier,fine_print,updated_at
    ) VALUES (
      @sku,@name,@category,@description,@short_description,@long_description,@badge,@base_price,@unit,@min_qty,
      @turnaround_days,@stock,1,1,@design_service_enabled,@design_service_fee,@design_service_help,
      @allow_artwork_upload,@website_order,@slug,@image_url,'{}',@pricing_mode,@unit_label,@rate_per_sqft,
      @minimum_sqft,@double_sided_multiplier,@fine_print,CURRENT_TIMESTAMP
    )`).run({
    sku: row.sku, name: row.name, category: row.category,
    description: row.short_description, short_description: row.short_description, long_description: row.long_description,
    badge: row.badge || null, base_price: row.base_price || 0, unit: row.unit || 'each', min_qty: row.min_qty || 1,
    turnaround_days: row.turnaround_days ?? 5, stock: null,
    design_service_enabled: row.design_service_enabled ? 1 : 0, design_service_fee: row.design_service_fee ?? 45,
    design_service_help: row.design_service_help || null, allow_artwork_upload: row.allow_artwork_upload ?? 1,
    website_order: nextWebsiteOrder(), slug, image_url: row.image_url || null,
    pricing_mode: row.pricing_mode, unit_label: row.unit_label || null, rate_per_sqft: row.rate_per_sqft ?? null,
    minimum_sqft: row.minimum_sqft ?? 1, double_sided_multiplier: row.double_sided_multiplier ?? 2,
    fine_print: row.fine_print || null,
  });
  const id = r.lastInsertRowid;
  db.prepare('INSERT INTO product_images (product_id,url,alt,is_primary,sort_order) VALUES (?,?,?,1,0)').run(id, row.image_url, row.name);
  return id;
}

export function seedPricingModeProducts() {
  if (getSetting('catalog_pricing_modes_v1')) return;
  if (!db.prepare('SELECT id FROM products LIMIT 1').get()) return; // base catalog seeds first

  db.transaction(() => {
    // ---------------------------------------------------- 4 matrix products
    const matrixDefs = [
      {
        sku: 'TIX-STAPLE-BW', name: 'Stapled Ticket Books — Black & White', file: 'stapled-ticket-books-bw.csv', image: 'prod-ticket-books-bw',
        short: 'Sequentially numbered stapled ticket books, black & white, 2–4 parts.',
        long: 'Stapled ticket books printed black and white, sequentially numbered, available in 2, 3 or 4 parts across three finished sizes. Priced per book quantity — pick your finished size, parts and how many books you need and the total is calculated automatically.',
        fine_print: null,
      },
      {
        sku: 'TIX-STAPLE-COLOR', name: 'Stapled Ticket Books — Full Color', file: 'stapled-ticket-books-color.csv', image: 'prod-ticket-books-color',
        short: 'Sequentially numbered stapled ticket books, full color, 2–4 parts.',
        long: 'Stapled ticket books printed full color, sequentially numbered, available in 2, 3 or 4 parts across three finished sizes. Priced per book quantity — pick your finished size, parts and how many books you need and the total is calculated automatically.',
        fine_print: 'The add-on guide is already included in every displayed price.',
      },
      {
        sku: 'TIX-GLUED-BW', name: 'Glued Edge Books — Black & White', file: 'glued-edge-bw.csv', image: 'prod-glued-edge-bw',
        short: 'Glued-edge ticket books, black & white, 2–4 parts.',
        long: 'Glued-edge (padded) ticket books printed black and white, sequentially numbered, available in 2, 3 or 4 parts across three finished sizes. Priced per book quantity — pick your finished size, parts and how many books you need and the total is calculated automatically. All prices shown in USD. Source prices preserved exactly.',
        fine_print: null,
      },
      {
        sku: 'TIX-GLUED-COLOR', name: 'Glued Edge Books — Full Color', file: 'glued-edge-color.csv', image: 'prod-glued-edge-color',
        short: 'Glued-edge ticket books, full color, 2–4 parts.',
        long: 'Glued-edge (padded) ticket books printed full color, sequentially numbered, available in 2, 3 or 4 parts across three finished sizes. Priced per book quantity — pick your finished size, parts and how many books you need and the total is calculated automatically. All prices shown in USD. Source prices preserved exactly.',
        fine_print: 'The add-on guide is already included in every displayed price.',
      },
    ];

    for (const def of matrixDefs) {
      const records = loadMatrixCsv(def.file);
      const { axes, cells } = buildMatrixFromRecords(records);
      const firstPrice = cells[0].price;
      const id = insertProduct({
        sku: def.sku, name: def.name, category: 'Business Print',
        short_description: def.short, long_description: def.long,
        base_price: firstPrice, unit: 'book', min_qty: 1, turnaround_days: 5,
        pricing_mode: 'matrix', fine_print: def.fine_print,
        image_url: IMG_PNG(def.image), design_service_enabled: 0,
      });
      insertMatrixProduct(id, axes, cells);
    }

    // ------------------------------------------------------------ sqft: banners
    {
      const id = insertProduct({
        sku: 'BAN-SQFT', name: 'Vinyl Banners', category: 'Signage & Banners',
        short_description: 'Full-color vinyl banners priced by the square foot — 13oz or 18oz.',
        long_description: 'Solvent-printed full-color vinyl banners priced by the exact square footage you need. Choose 13oz standard scrim vinyl or 18oz heavy-duty scrim; double-sided printing is available on 18oz only. Enter width and height in inches and the price is calculated to the cent.',
        base_price: 5.5, unit: 'sqft', min_qty: 1, turnaround_days: 5,
        pricing_mode: 'sqft', minimum_sqft: 1, double_sided_multiplier: 2,
        image_url: IMG_PNG('prod-vinyl-banner'), design_service_enabled: 1, design_service_fee: 55,
      });
      db.prepare('INSERT INTO product_materials (product_id,label,rate_per_sqft,allows_double_sided,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '13oz', 5.5, 0, 0);
      db.prepare('INSERT INTO product_materials (product_id,label,rate_per_sqft,allows_double_sided,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '18oz', 6.5, 1, 1);
    }

    // ------------------------------------------------ sqft: large format posters
    {
      insertProduct({
        sku: 'POST-SQFT', name: 'Large Format Posters', category: 'Signage & Banners',
        short_description: 'Single-sided large format posters priced by the square foot.',
        long_description: 'Large format poster printing priced by the exact square footage you need, single-sided only. Enter width and height in inches for an instant price. Great for trade show graphics, event signage and in-store displays.',
        base_price: 4.5, unit: 'sqft', min_qty: 1, turnaround_days: 3,
        pricing_mode: 'sqft', rate_per_sqft: 4.5, minimum_sqft: 1, double_sided_multiplier: 2,
        image_url: IMG_PNG('prod-large-format-poster'), design_service_enabled: 0,
      });
      // no product_materials rows: single flat rate_per_sqft on the product itself,
      // and no double-sided option since posters are single-sided only.
      const p = db.prepare('SELECT id FROM products WHERE sku=?').get('POST-SQFT');
      db.prepare('UPDATE products SET double_sided_multiplier=1 WHERE id=?').run(p.id); // hard-disable double pricing bump
    }

    // ------------------------------------------------------- flat_option: cards
    {
      const id = insertProduct({
        sku: 'BUS-CARD-FLAT', name: 'Business Cards', category: 'Business Print',
        short_description: '16pt full-color business cards — 250 or 500 per box.',
        long_description: '16pt stock business cards, full color, boxed and ready to hand out. Choose 250 or 500 cards; the price shown is the total for that box, not a per-card rate.',
        base_price: 85, unit: 'box', min_qty: 1, turnaround_days: 4,
        pricing_mode: 'flat_option', unit_label: null,
        image_url: IMG_PNG('prod-business-cards'), design_service_enabled: 1, design_service_fee: 35,
      });
      db.prepare('INSERT INTO product_options (product_id,label,price,sku_suffix,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '250 cards', 85.0, '250', 0);
      db.prepare('INSERT INTO product_options (product_id,label,price,sku_suffix,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '500 cards', 95.0, '500', 1);
    }

    // ------------------------------------------------ flat_option: engineering
    {
      const id = insertProduct({
        sku: 'ENG-DRAW-FLAT', name: 'Engineering Drawings', category: 'Blueprints',
        short_description: 'Large-format engineering drawing prints, priced per sheet.',
        long_description: 'Wide-format engineering drawing prints priced per sheet by finished size. Pick the sheet size and enter how many sheets you need — the price shown is per sheet.',
        base_price: 1.25, unit: 'sheet', min_qty: 1, turnaround_days: 2,
        pricing_mode: 'flat_option', unit_label: 'per sheet',
        image_url: IMG_PNG('prod-engineering-drawings'), design_service_enabled: 0,
      });
      db.prepare('INSERT INTO product_options (product_id,label,price,sku_suffix,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '11" x 17"', 1.25, '11X17', 0);
      db.prepare('INSERT INTO product_options (product_id,label,price,sku_suffix,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '24" x 36"', 4.5, '24X36', 1);
      db.prepare('INSERT INTO product_options (product_id,label,price,sku_suffix,sort_order,active) VALUES (?,?,?,?,?,1)').run(id, '40" x 32"', 5.0, '40X32', 2);
    }
  })();

  setSetting('catalog_pricing_modes_v1', new Date().toISOString());
}
