// Catalog reads + the single source of pricing truth.
//
// PRICING RESOLUTION (documented in API.md — keep the two in sync):
//   1. base(qty)  = the highest price_tier whose min_qty <= qty, else product.base_price
//   2. variant with a non-null `price`     → unit = variant.price          (tiers ignored)
//      variant with a null price + upcharge → unit = base(qty) + upcharge
//      no variant                          → unit = base(qty)
//   3. line_total = round2(unit * qty)
//   4. design service adds product.design_service_fee (or the shop default) ONCE per line
//   5. rush adds rush_fee_pct of the order subtotal, then tax, then shipping
import { bumpCatalogRev, catalogRev, db, getSetting } from './db.js';
import { pricingDataFor } from './pricing.js';

export const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const bool01 = (v, dflt = 0) => {
  if (v === undefined || v === null || v === '') return dflt;
  if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') return 1;
  return 0;
};

export const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

export function imagesFor(productId) {
  return db.prepare('SELECT id,url,alt,is_primary,sort_order FROM product_images WHERE product_id=? ORDER BY is_primary DESC, sort_order, id').all(productId);
}
export function variantsFor(productId, onlyActive = false) {
  return db.prepare(`SELECT id,label,kind,price,upcharge,sku_suffix,stock,active,sort_order FROM product_variants
    WHERE product_id=? ${onlyActive ? 'AND active=1' : ''} ORDER BY sort_order, id`).all(productId);
}
export function tiersFor(productId) {
  return db.prepare('SELECT id,min_qty,unit_price FROM price_tiers WHERE product_id=? ORDER BY min_qty').all(productId);
}

/** Step 1 — quantity price break lookup. */
export function tierPrice(product, tiers, qty) {
  const q = Math.max(1, Number(qty) || 1);
  let price = Number(product.base_price) || 0;
  for (const t of tiers || []) if (q >= t.min_qty) price = Number(t.unit_price);
  return money(price);
}

/** Steps 1–2 — resolved unit price for an optional variant at a quantity. */
export function resolveUnitPrice(product, { tiers, variant = null, qty = null } = {}) {
  const t = tiers || tiersFor(product.id);
  const base = tierPrice(product, t, qty ?? product.min_qty ?? 1);
  if (!variant) return base;
  if (variant.price !== null && variant.price !== undefined) return money(variant.price);
  return money(base + (Number(variant.upcharge) || 0));
}

export function designDefaults() {
  return {
    fee: Number(getSetting('design_service_fee', '45')) || 0,
    help_text: getSetting('design_service_help', '') || '',
    notify_email: getSetting('design_notify_email', '') || '',
    enabled_default: getSetting('design_service_enabled_default', '1') === '1',
  };
}

/**
 * The exact JSON shape the public website consumes. Used by
 * GET /api/public/products and GET /api/public/products/:slug.
 */
export function absUrl(u, origin = '') {
  if (!u) return u;
  if (/^https?:\/\//.test(u)) return u;
  return origin ? `${origin}${u.startsWith('/') ? '' : '/'}${u}` : u;
}

export function publicProduct(p, origin = '') {
  const tiers = tiersFor(p.id);
  const variants = variantsFor(p.id, true);
  const d = designDefaults();
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    category: p.category,
    badge: p.badge || null,
    short_description: p.short_description || p.description || '',
    long_description: p.long_description || p.description || '',
    base_price: money(p.base_price),
    unit: p.unit,
    min_qty: p.min_qty,
    turnaround_days: p.turnaround_days,
    website_order: p.website_order,
    pricing_mode: p.pricing_mode || 'tiered_unit',
    unit_label: p.unit_label || null,
    fine_print: p.fine_print || null,
    pricing: pricingDataFor(p),
    images: imagesFor(p.id).map((i) => ({
      url: absUrl(i.url, origin),          // absolute — safe to drop straight into <img src>
      path: i.url,                          // OS-relative original
      alt: i.alt || p.name,
      is_primary: !!i.is_primary,
    })),
    variants: variants.map((v) => ({
      label: v.label,
      kind: v.kind,
      unit_price: resolveUnitPrice(p, { tiers, variant: v, qty: p.min_qty }),
      price: v.price === null || v.price === undefined ? null : money(v.price),
      upcharge: v.upcharge === null || v.upcharge === undefined ? null : money(v.upcharge),
      sku_suffix: v.sku_suffix || null,
      active: !!v.active,
      stock: v.stock === null || v.stock === undefined ? null : v.stock,
    })),
    price_tiers: tiers.map((t) => ({ min_qty: t.min_qty, unit_price: money(t.unit_price) })),
    design_service: {
      enabled: !!p.design_service_enabled,
      fee: money(p.design_service_enabled ? (p.design_service_fee || d.fee) : p.design_service_fee),
      help_text: p.design_service_help || d.help_text,
    },
    allow_artwork_upload: !!p.allow_artwork_upload,
    stock: p.stock === null || p.stock === undefined ? null : p.stock,
    options: safeParse(p.options_json) || {},
    updated_at: p.updated_at || null,
  };
}

export function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export function publishedProducts() {
  return db.prepare(`SELECT * FROM products WHERE published = 1 AND active = 1
    ORDER BY COALESCE(website_order, 9999), name`).all();
}

/** Cheap cache key for the website: max updated_at + published count. */
export function catalogVersion() {
  const row = db.prepare(`SELECT COUNT(*) published, MAX(updated_at) max_updated FROM products WHERE published=1 AND active=1`).get();
  const all = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  const imgs = db.prepare('SELECT COUNT(*) n FROM product_images').get().n;
  const vars = db.prepare('SELECT COUNT(*) n FROM product_variants').get().n;
  const rev = catalogRev();
  const stamp = `${row.max_updated || 'none'}|${row.published}|${all}|${imgs}|${vars}|${rev}`;
  let hash = 0;
  for (let i = 0; i < stamp.length; i++) hash = (hash * 31 + stamp.charCodeAt(i)) >>> 0;
  return {
    version: hash.toString(36),
    etag: `W/"cat-${hash.toString(36)}"`,
    revision: rev,
    published_count: row.published,
    product_count: all,
    updated_at: row.max_updated || null,
    checked_at: new Date().toISOString(),
  };
}

export function touchProduct(id) {
  db.prepare('UPDATE products SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
  bumpCatalogRev();
}

/** Admin list row — includes counts and the primary image. */
export function adminProduct(p) {
  const threshold = Number(getSetting('low_stock_threshold') || 48);
  const images = imagesFor(p.id);
  return {
    ...p,
    options: safeParse(p.options_json) || {},
    low_stock: p.stock !== null && p.stock <= threshold,
    images,
    primary_image: images.find((i) => i.is_primary)?.url || images[0]?.url || p.image_url || null,
    image_count: images.length,
    variants: variantsFor(p.id),
    variant_count: db.prepare('SELECT COUNT(*) n FROM product_variants WHERE product_id=?').get(p.id).n,
    price_tiers: tiersFor(p.id),
    pricing_mode: p.pricing_mode || 'tiered_unit',
    pricing: pricingDataFor(p),
  };
}
