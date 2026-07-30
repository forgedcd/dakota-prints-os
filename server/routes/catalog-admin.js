// Catalog management endpoints — everything the OS Products page needs to own
// the public website's catalog: publish toggles, ordering, variants, price
// tiers, multi-image upload and the design-service flags.
// Mounted under /api/os (auth required) from routes/os.js.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { bumpCatalogRev, db, getSetting, UPLOAD_DIR, uniqueSlug, slugify } from '../db.js';
import { notify } from '../services.js';
import {
  adminProduct, bool01, catalogVersion, designDefaults, imagesFor, money,
  numOrNull, resolveUnitPrice, tiersFor, touchProduct, variantsFor,
} from '../catalog.js';

const router = express.Router();

// Any successful write here changes what the website sells, so bump the catalog
// revision — that is what /api/public/catalog-version hashes into its etag.
router.use('/products', (req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => { if (res.statusCode < 400) { try { bumpCatalogRev(); } catch { /* never break the write */ } } });
  }
  next();
});

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1600;               // images are downscaled to fit this box
const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/;

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 12 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE.test(file.mimetype)) return cb(new Error(`Unsupported image type: ${file.mimetype}. Use JPG, PNG, WEBP, GIF or AVIF.`));
    cb(null, true);
  },
});

/** Write a validated, downscaled copy into UPLOAD_DIR and return its public path. */
async function storeImage(file, prefix = 'prod') {
  fs.mkdirSync(path.resolve(UPLOAD_DIR), { recursive: true });
  const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '');
  const name = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}.webp`;
  const dest = path.join(path.resolve(UPLOAD_DIR), name);
  await sharp(file.buffer, { animated: file.mimetype === 'image/gif' })
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(dest);
  return `/uploads/${name}`;
}

const productById = (id) => db.prepare('SELECT * FROM products WHERE id=?').get(id);

// ---------------------------------------------------------------- list + meta
router.get('/products', (_req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY COALESCE(website_order, 9999), name').all();
  res.json(rows.map(adminProduct));
});

router.get('/catalog/summary', (_req, res) => {
  const v = catalogVersion();
  res.json({
    ...v,
    hidden_count: v.product_count - v.published_count,
    categories: db.prepare('SELECT category, COUNT(*) n, SUM(published) published FROM products GROUP BY category ORDER BY category').all(),
    design_service_products: db.prepare('SELECT COUNT(*) n FROM products WHERE design_service_enabled=1').get().n,
    defaults: designDefaults(),
  });
});

// ------------------------------------------------------------------ write path
const PRODUCT_FIELDS = [
  'sku', 'name', 'category', 'description', 'short_description', 'long_description', 'badge',
  'base_price', 'unit', 'min_qty', 'turnaround_days', 'stock', 'active', 'published',
  'design_service_enabled', 'design_service_fee', 'design_service_help', 'allow_artwork_upload',
  'website_order', 'slug', 'image_url', 'options_json',
];

function normalise(body, existing = null) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (has('sku')) out.sku = String(body.sku).trim().toUpperCase();
  if (has('name')) out.name = String(body.name).trim();
  if (has('category')) out.category = body.category;
  if (has('description')) out.description = body.description || null;
  if (has('short_description')) out.short_description = body.short_description || null;
  if (has('long_description')) out.long_description = body.long_description || null;
  if (has('badge')) out.badge = body.badge ? String(body.badge).trim() : null;
  if (has('base_price')) out.base_price = money(body.base_price);
  if (has('unit')) out.unit = body.unit || 'each';
  if (has('min_qty')) out.min_qty = Math.max(1, Number(body.min_qty) || 1);
  if (has('turnaround_days')) out.turnaround_days = Math.max(0, Number(body.turnaround_days) || 0);
  if (has('stock')) out.stock = numOrNull(body.stock);
  if (has('active')) out.active = bool01(body.active, 1);
  if (has('published')) out.published = bool01(body.published, 1);
  if (has('design_service_enabled')) out.design_service_enabled = bool01(body.design_service_enabled, 0);
  if (has('design_service_fee')) out.design_service_fee = money(body.design_service_fee);
  if (has('design_service_help')) out.design_service_help = body.design_service_help || null;
  if (has('allow_artwork_upload')) out.allow_artwork_upload = bool01(body.allow_artwork_upload, 1);
  if (has('website_order')) out.website_order = Number(body.website_order) || null;
  if (has('image_url')) out.image_url = body.image_url || null;
  if (has('options_json')) out.options_json = typeof body.options_json === 'string' ? body.options_json : JSON.stringify(body.options_json || {});
  else if (has('options')) out.options_json = JSON.stringify(body.options || {});
  if (has('slug') && body.slug) out.slug = uniqueSlug(slugify(body.slug), existing?.id);
  else if (!existing && out.name) out.slug = uniqueSlug(out.name);
  return out;
}

router.post('/products', (req, res) => {
  const p = normalise(req.body || {});
  if (!p.sku || !p.name) return res.status(400).json({ error: 'sku and name are required' });
  const d = designDefaults();
  const row = {
    sku: p.sku, name: p.name, category: p.category || 'Apparel', description: p.description || null,
    short_description: p.short_description || null, long_description: p.long_description || null,
    badge: p.badge || null, base_price: p.base_price || 0, unit: p.unit || 'each',
    min_qty: p.min_qty || 1, turnaround_days: p.turnaround_days ?? 7, stock: p.stock ?? null,
    active: p.active ?? 1, published: p.published ?? 1,
    design_service_enabled: p.design_service_enabled ?? 0,
    design_service_fee: p.design_service_fee ?? d.fee,
    design_service_help: p.design_service_help || null,
    allow_artwork_upload: p.allow_artwork_upload ?? 1,
    slug: p.slug, image_url: p.image_url || null, options_json: p.options_json || '{}',
    website_order: p.website_order || (db.prepare('SELECT COALESCE(MAX(website_order),0)+1 n FROM products').get().n),
  };
  try {
    const r = db.prepare(`INSERT INTO products (sku,name,category,description,short_description,long_description,badge,base_price,unit,
      min_qty,turnaround_days,stock,active,published,design_service_enabled,design_service_fee,design_service_help,allow_artwork_upload,
      slug,image_url,options_json,website_order,updated_at)
      VALUES (@sku,@name,@category,@description,@short_description,@long_description,@badge,@base_price,@unit,@min_qty,@turnaround_days,
      @stock,@active,@published,@design_service_enabled,@design_service_fee,@design_service_help,@allow_artwork_upload,@slug,@image_url,
      @options_json,@website_order,CURRENT_TIMESTAMP)`).run(row);
    res.status(201).json(adminProduct(productById(r.lastInsertRowid)));
  } catch (e) {
    res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'That SKU or slug is already in use' : e.message });
  }
});

router.patch('/products/:id', (req, res) => {
  const existing = productById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const p = normalise(req.body || {}, existing);
  const keys = Object.keys(p).filter((k) => PRODUCT_FIELDS.includes(k));
  if (keys.length) {
    try {
      db.prepare(`UPDATE products SET ${keys.map((k) => `${k}=@${k}`).join(',')}, updated_at=CURRENT_TIMESTAMP WHERE id=@id`)
        .run({ ...p, id: existing.id });
    } catch (e) {
      return res.status(400).json({ error: /UNIQUE/.test(e.message) ? 'That SKU or slug is already in use' : e.message });
    }
  }
  // low-stock automation kept from the original build
  const after = productById(existing.id);
  const threshold = Number(getSetting('low_stock_threshold') || 48);
  if (after.stock !== null && after.stock <= threshold) {
    const dupe = db.prepare("SELECT id FROM tasks WHERE title=? AND status='open'").get(`Restock blanks: ${after.name}`);
    if (!dupe) {
      db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (NULL,?,?,?,?,?)')
        .run(`Restock blanks: ${after.name}`, 'followup', 'open', new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), req.user.name);
      notify('low_stock', `Blank stock low — ${after.name}`, `${after.stock} on hand, at or below the ${threshold} reorder point.`, null);
    }
  }
  res.json(adminProduct(after));
});

// One-click publish / unpublish (the list-view switch).
router.post('/products/:id/publish', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const published = bool01(req.body?.published, p.published ? 0 : 1);
  db.prepare('UPDATE products SET published=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(published, p.id);
  res.json({ id: p.id, published, live: !!(published && p.active), updated_at: productById(p.id).updated_at });
});

// Bulk publish / unpublish / recategorise.
router.post('/products/bulk', (req, res) => {
  const { ids = [], action, category } = req.body || {};
  const list = ids.map(Number).filter(Boolean);
  if (!list.length) return res.status(400).json({ error: 'ids required' });
  const inClause = list.map(() => '?').join(',');
  if (action === 'publish' || action === 'unpublish') {
    db.prepare(`UPDATE products SET published=?, updated_at=CURRENT_TIMESTAMP WHERE id IN (${inClause})`)
      .run(action === 'publish' ? 1 : 0, ...list);
  } else if (action === 'category') {
    if (!category) return res.status(400).json({ error: 'category required' });
    db.prepare(`UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE id IN (${inClause})`).run(category, ...list);
  } else if (action === 'archive') {
    db.prepare(`UPDATE products SET active=0, published=0, updated_at=CURRENT_TIMESTAMP WHERE id IN (${inClause})`).run(...list);
  } else {
    return res.status(400).json({ error: 'action must be publish, unpublish, archive or category' });
  }
  res.json({ updated: list.length, action });
});

// Website sort order: accept a full ordered id list, or nudge one product.
router.post('/products/reorder', (req, res) => {
  const { ids = [], id, direction } = req.body || {};
  if (Array.isArray(ids) && ids.length) {
    const stmt = db.prepare('UPDATE products SET website_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    db.transaction(() => ids.forEach((pid, i) => stmt.run(i + 1, Number(pid))))();
    return res.json({ ok: true, ordered: ids.length });
  }
  if (id && direction) {
    const all = db.prepare('SELECT id FROM products ORDER BY COALESCE(website_order,9999), name').all().map((r) => r.id);
    const i = all.indexOf(Number(id));
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= all.length) return res.json({ ok: true, ordered: 0 });
    [all[i], all[j]] = [all[j], all[i]];
    const stmt = db.prepare('UPDATE products SET website_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?');
    db.transaction(() => all.forEach((pid, k) => stmt.run(k + 1, pid)))();
    return res.json({ ok: true, ordered: all.length });
  }
  res.status(400).json({ error: 'ids[] or { id, direction } required' });
});

router.post('/products/:id/duplicate', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  let sku = `${p.sku}-COPY`;
  let n = 2;
  while (db.prepare('SELECT id FROM products WHERE sku=?').get(sku)) sku = `${p.sku}-COPY${n++}`;
  const name = `${p.name} (copy)`;
  const newId = db.transaction(() => {
    const r = db.prepare(`INSERT INTO products (sku,name,category,description,short_description,long_description,badge,base_price,unit,
      min_qty,turnaround_days,stock,active,published,design_service_enabled,design_service_fee,design_service_help,allow_artwork_upload,
      slug,image_url,options_json,website_order,updated_at)
      SELECT ?,?,category,description,short_description,long_description,badge,base_price,unit,min_qty,turnaround_days,stock,active,0,
      design_service_enabled,design_service_fee,design_service_help,allow_artwork_upload,?,image_url,options_json,
      (SELECT COALESCE(MAX(website_order),0)+1 FROM products),CURRENT_TIMESTAMP FROM products WHERE id=?`)
      .run(sku, name, uniqueSlug(name), p.id);
    const id = r.lastInsertRowid;
    db.prepare('INSERT INTO product_images (product_id,url,alt,is_primary,sort_order) SELECT ?,url,alt,is_primary,sort_order FROM product_images WHERE product_id=?').run(id, p.id);
    db.prepare('INSERT INTO product_variants (product_id,label,kind,price,upcharge,sku_suffix,stock,active,sort_order) SELECT ?,label,kind,price,upcharge,sku_suffix,stock,active,sort_order FROM product_variants WHERE product_id=?').run(id, p.id);
    db.prepare('INSERT INTO price_tiers (product_id,min_qty,unit_price) SELECT ?,min_qty,unit_price FROM price_tiers WHERE product_id=?').run(id, p.id);
    return id;
  })();
  res.status(201).json(adminProduct(productById(newId)));
});

router.delete('/products/:id', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (String(req.query.mode) === 'archive') {
    db.prepare('UPDATE products SET active=0, published=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(p.id);
    return res.json({ archived: true, id: p.id });
  }
  db.prepare('DELETE FROM products WHERE id=?').run(p.id);
  res.json({ deleted: true, id: p.id });
});

// --------------------------------------------------------------------- images
router.get('/products/:id/images', (req, res) => res.json(imagesFor(Number(req.params.id))));

router.post('/products/:id/images', imageUpload.array('files', 12), async (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const files = req.files || [];
  const urls = (req.body?.urls ? [].concat(req.body.urls) : []).filter(Boolean);
  if (!files.length && !urls.length) return res.status(400).json({ error: 'No images uploaded' });

  const start = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM product_images WHERE product_id=?').get(p.id).n;
  const hasPrimary = !!db.prepare('SELECT id FROM product_images WHERE product_id=? AND is_primary=1').get(p.id);
  const ins = db.prepare('INSERT INTO product_images (product_id,url,alt,is_primary,sort_order) VALUES (?,?,?,?,?)');

  let i = 0;
  try {
    for (const f of files) {
      const url = await storeImage(f, 'prod');
      ins.run(p.id, url, req.body?.alt || p.name, !hasPrimary && i === 0 ? 1 : 0, start + i);
      i++;
    }
    for (const url of urls) {
      ins.run(p.id, url, req.body?.alt || p.name, !hasPrimary && i === 0 ? 1 : 0, start + i);
      i++;
    }
  } catch (e) {
    return res.status(400).json({ error: `Image processing failed: ${e.message}` });
  }
  const primary = db.prepare('SELECT url FROM product_images WHERE product_id=? AND is_primary=1').get(p.id);
  if (primary) db.prepare('UPDATE products SET image_url=? WHERE id=?').run(primary.url, p.id);
  touchProduct(p.id);
  res.status(201).json({ added: i, images: imagesFor(p.id) });
});

router.patch('/products/:id/images/:imageId', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id=? AND product_id=?').get(req.params.imageId, req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  if (req.body.alt !== undefined) db.prepare('UPDATE product_images SET alt=? WHERE id=?').run(req.body.alt || null, img.id);
  if (req.body.is_primary) {
    db.prepare('UPDATE product_images SET is_primary=0 WHERE product_id=?').run(img.product_id);
    db.prepare('UPDATE product_images SET is_primary=1 WHERE id=?').run(img.id);
    db.prepare('UPDATE products SET image_url=? WHERE id=?').run(img.url, img.product_id);
  }
  touchProduct(img.product_id);
  res.json(imagesFor(img.product_id));
});

router.post('/products/:id/images/reorder', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  const stmt = db.prepare('UPDATE product_images SET sort_order=? WHERE id=? AND product_id=?');
  db.transaction(() => ids.forEach((id, i) => stmt.run(i, id, Number(req.params.id))))();
  touchProduct(Number(req.params.id));
  res.json(imagesFor(Number(req.params.id)));
});

router.delete('/products/:id/images/:imageId', (req, res) => {
  const img = db.prepare('SELECT * FROM product_images WHERE id=? AND product_id=?').get(req.params.imageId, req.params.id);
  if (!img) return res.status(404).json({ error: 'Image not found' });
  db.prepare('DELETE FROM product_images WHERE id=?').run(img.id);
  if (img.is_primary) {
    const next = db.prepare('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order, id LIMIT 1').get(img.product_id);
    if (next) {
      db.prepare('UPDATE product_images SET is_primary=1 WHERE id=?').run(next.id);
      db.prepare('UPDATE products SET image_url=? WHERE id=?').run(next.url, img.product_id);
    } else {
      db.prepare('UPDATE products SET image_url=NULL WHERE id=?').run(img.product_id);
    }
  }
  touchProduct(img.product_id);
  res.json(imagesFor(img.product_id));
});

// ------------------------------------------------------------------- variants
const VARIANT_KINDS = ['size', 'dimension', 'option'];

router.get('/products/:id/variants', (req, res) => res.json(variantsFor(Number(req.params.id))));

/** Full replace — the editor posts the whole table, which keeps ordering simple. */
router.put('/products/:id/variants', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const rows = Array.isArray(req.body?.variants) ? req.body.variants : Array.isArray(req.body) ? req.body : [];
  for (const v of rows) {
    if (!String(v.label || '').trim()) return res.status(400).json({ error: 'Every variant needs a label' });
    if (v.kind && !VARIANT_KINDS.includes(v.kind)) return res.status(400).json({ error: `kind must be one of ${VARIANT_KINDS.join(', ')}` });
    if (numOrNull(v.price) !== null && numOrNull(v.upcharge)) {
      return res.status(400).json({ error: `"${v.label}" has both an absolute price and an upcharge — pick one.` });
    }
  }
  const ins = db.prepare(`INSERT INTO product_variants (product_id,label,kind,price,upcharge,sku_suffix,stock,active,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    db.prepare('DELETE FROM product_variants WHERE product_id=?').run(p.id);
    rows.forEach((v, i) => ins.run(
      p.id, String(v.label).trim(), v.kind || 'size',
      numOrNull(v.price), numOrNull(v.upcharge) ?? (numOrNull(v.price) === null ? 0 : null),
      v.sku_suffix || null, numOrNull(v.stock), bool01(v.active, 1), i,
    ));
  })();
  touchProduct(p.id);
  res.json(variantsFor(p.id));
});

/** "Quick add standard apparel sizes" helper. */
router.post('/products/:id/variants/apparel', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const preset = [['S', 0], ['M', 0], ['L', 0], ['XL', 0], ['2XL', 2], ['3XL', 3], ['4XL', 4]];
  const existing = new Set(variantsFor(p.id).map((v) => v.label.toUpperCase()));
  let sort = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM product_variants WHERE product_id=?').get(p.id).n;
  const ins = db.prepare(`INSERT INTO product_variants (product_id,label,kind,price,upcharge,sku_suffix,stock,active,sort_order)
    VALUES (?,?,'size',NULL,?,?,NULL,1,?)`);
  let added = 0;
  for (const [label, up] of preset) {
    if (existing.has(label)) continue;
    ins.run(p.id, label, up, label.replace(/\W/g, ''), sort++);
    added++;
  }
  touchProduct(p.id);
  res.status(201).json({ added, variants: variantsFor(p.id) });
});

// ---------------------------------------------------------------- price tiers
router.get('/products/:id/price-tiers', (req, res) => res.json(tiersFor(Number(req.params.id))));

router.put('/products/:id/price-tiers', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const body = Array.isArray(req.body?.price_tiers) ? req.body.price_tiers
    : Array.isArray(req.body?.tiers) ? req.body.tiers : Array.isArray(req.body) ? req.body : [];
  const rows = body
    .map((t) => ({ min_qty: Math.max(1, Number(t.min_qty) || 0), unit_price: money(t.unit_price) }))
    .filter((t) => t.min_qty > 0);
  const sorted = [...rows].sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].min_qty === sorted[i - 1].min_qty) return res.status(400).json({ error: `Duplicate break quantity ${sorted[i].min_qty}` });
    if (sorted[i].unit_price > sorted[i - 1].unit_price) {
      return res.status(400).json({ error: `Break at ${sorted[i].min_qty}+ costs more than the ${sorted[i - 1].min_qty}+ break — breaks should get cheaper as quantity rises.` });
    }
  }
  const ins = db.prepare('INSERT INTO price_tiers (product_id,min_qty,unit_price) VALUES (?,?,?)');
  db.transaction(() => {
    db.prepare('DELETE FROM price_tiers WHERE product_id=?').run(p.id);
    sorted.forEach((t) => ins.run(p.id, t.min_qty, t.unit_price));
  })();
  touchProduct(p.id);
  res.json(tiersFor(p.id));
});

/** Live "example price at qty X" used by the Pricing tab calculator. */
router.get('/products/:id/quote', (req, res) => {
  const p = productById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const qty = Math.max(1, Number(req.query.qty) || p.min_qty || 1);
  const tiers = tiersFor(p.id);
  const label = req.query.variant ? String(req.query.variant) : null;
  const variant = label ? variantsFor(p.id).find((v) => v.label.toLowerCase() === label.toLowerCase()) : null;
  const unit = resolveUnitPrice(p, { tiers, variant, qty });
  const design = req.query.design === '1' ? money(p.design_service_fee || designDefaults().fee) : 0;
  const rushPct = Number(getSetting('rush_fee_pct') || 0) / 100;
  const taxRate = Number(getSetting('tax_rate') || 0) / 100;
  const subtotal = money(unit * qty + design);
  const rush = req.query.rush === '1' ? money(subtotal * rushPct) : 0;
  res.json({
    qty, unit_price: unit, variant: variant?.label || null,
    base_price: money(p.base_price), tier_applied: tiers.filter((t) => qty >= t.min_qty).pop() || null,
    design_fee: design, subtotal, rush_fee: rush,
    tax: money((subtotal + rush) * taxRate), total: money(subtotal + rush + (subtotal + rush) * taxRate),
    below_min_qty: qty < (p.min_qty || 1),
  });
});

export default router;
