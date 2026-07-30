// PUBLIC API — the contract the separate dakotaprints.com website consumes.
// Full documentation (JSON shapes + pricing rules) lives in /API.md.
//
//   GET  /api/public/products              published catalog, sorted by website_order
//   GET  /api/public/products/:slug        one product (404 when unpublished)
//   GET  /api/public/catalog-version       cheap etag/timestamp for caching
//   GET  /api/public/settings              shop profile + design-service defaults
//   POST /api/public/orders                order intake            (x-webhook-token)
//   POST /api/public/uploads               multi-file upload       (x-webhook-token)
//   POST /api/public/artwork               legacy single upload    (x-webhook-token optional)
//   GET  /api/public/track/:orderNumber    customer order tracking
//
// Every call is written to webhook_log so Settings → Website integration can
// show the last 20.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, getSetting, orderNumber, UPLOAD_DIR } from '../db.js';
import { addEvent, createTaskChain, notify, logMessage, logWebhook, renderTemplate, safeJson, STATUS_LABEL } from '../services.js';
import {
  absUrl, catalogVersion, designDefaults, money, publicProduct, publishedProducts,
  resolveUnitPrice, tiersFor, variantsFor,
} from '../catalog.js';

const router = express.Router();

// ---------------------------------------------------------------------- CORS
// WEBSITE_ORIGINS is a comma-separated allow-list; '*' (the dev default) lets
// any origin read the catalog.
const ORIGINS = (process.env.WEBSITE_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ORIGINS.includes('*') || !origin) res.setHeader('Access-Control-Allow-Origin', origin || '*');
  else if (ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    // Not on the allow-list — drop the permissive header the app-level middleware set.
    res.removeHeader('Access-Control-Allow-Origin');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const originOf = (req) => `${req.protocol}://${req.get('host')}`;

const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || '').replace('::ffff:', '') || 'unknown';

/** Log the inbound call once the response is on its way out. */
function auditable(label) {
  return (req, res, next) => {
    res.on('finish', () => {
      try {
        logWebhook({
          endpoint: `${req.method} /api/public${label === ':order' ? '/track/' + (req.params.orderNumber || '') : label}`,
          status: res.statusCode,
          order_number: res.locals.order_number || req.params.orderNumber || null,
          ip: clientIp(req),
          payload_preview: req.method === 'GET'
            ? (new URLSearchParams(req.query).toString() || '—')
            : JSON.stringify(req.body || {}),
        });
      } catch { /* logging must never break the bridge */ }
    });
    next();
  };
}

function tokenOk(req) {
  const expected = getSetting('webhook_token');
  const provided = req.headers['x-webhook-token'] || req.body?.webhook_token;
  return !expected || provided === expected;
}

// Shop profile the website can render in its footer / checkout.
router.get('/settings', (_req, res) => {
  const d = designDefaults();
  res.json({
    shop_name: getSetting('shop_name'),
    shop_tagline: getSetting('shop_tagline'),
    shop_phone: getSetting('shop_phone'),
    shop_email: getSetting('shop_email'),
    shop_address: getSetting('shop_address'),
    tax_rate: Number(getSetting('tax_rate')),
    rush_fee_pct: Number(getSetting('rush_fee_pct')),
    default_turnaround: Number(getSetting('default_turnaround')),
    free_shipping_threshold: 500,
    flat_shipping: 24.5,
    design_service: { default_fee: d.fee, help_text: d.help_text, enabled_default: d.enabled_default },
  });
});

// ---------------------------------------------------------- catalog (published)
router.get('/products', auditable('/products'), (req, res) => {
  const { category, q } = req.query;
  let rows = publishedProducts();
  if (category && category !== 'All') rows = rows.filter((p) => p.category === category);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((p) => `${p.name} ${p.sku} ${p.short_description || ''} ${p.description || ''}`.toLowerCase().includes(needle));
  }
  const version = catalogVersion();
  res.setHeader('ETag', version.etag);
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json({
    count: rows.length,
    catalog_version: version.version,
    updated_at: version.updated_at,
    synced_at: new Date().toISOString(),
    products: rows.map((p) => publicProduct(p, originOf(req))),
  });
});

// Single product by slug (SKU also accepted so older website code keeps working).
router.get('/products/:slug', auditable('/products/:slug'), (req, res) => {
  const key = String(req.params.slug);
  const p = db.prepare(`SELECT * FROM products WHERE (slug = ? COLLATE NOCASE OR sku = ? COLLATE NOCASE)
    AND published = 1 AND active = 1`).get(key, key);
  if (!p) return res.status(404).json({ error: 'Product not found or not published' });
  res.setHeader('Cache-Control', 'public, max-age=30');
  res.json(publicProduct(p, originOf(req)));
});

// Cheap cache key: max(updated_at) + counts, hashed.
router.get('/catalog-version', (_req, res) => {
  const v = catalogVersion();
  res.setHeader('ETag', v.etag);
  res.setHeader('Cache-Control', 'public, max-age=10');
  res.json(v);
});

// ------------------------------------------------------------------- uploads
const UPLOAD_LIMIT = 24 * 1024 * 1024;
const diskStore = (prefix) => multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { fs.mkdirSync(path.resolve(UPLOAD_DIR), { recursive: true }); cb(null, path.resolve(UPLOAD_DIR)); },
    filename: (_r, file, cb) => cb(null, `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: UPLOAD_LIMIT, files: 10 },
});

// POST /api/public/uploads — multipart, token-protected. Field names artwork /
// logo / reference (or a generic "files" field) all land in the same response.
router.post('/uploads', auditable('/uploads'),
  diskStore('cust').fields([
    { name: 'files', maxCount: 10 }, { name: 'artwork', maxCount: 10 },
    { name: 'logo', maxCount: 10 }, { name: 'reference', maxCount: 10 },
  ]),
  (req, res) => {
    if (!tokenOk(req)) return res.status(401).json({ error: 'Invalid webhook token' });
    const groups = req.files || {};
    const out = [];
    for (const [field, list] of Object.entries(groups)) {
      const kind = ['artwork', 'logo', 'reference'].includes(field) ? field : (req.body?.kind || 'artwork');
      for (const f of list) out.push({ url: `/uploads/${f.filename}`, filename: f.originalname, kind, bytes: f.size });
    }
    if (!out.length) return res.status(400).json({ error: 'No files uploaded' });
    res.status(201).json({ count: out.length, files: out });
  });

// Legacy single-file endpoint kept for the existing website build.
router.post('/artwork', diskStore('art').single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname, kind: 'artwork' });
});

// ---------------------------------------------------------------------------
// POST /api/public/orders — the headline bridge. Prices are ALWAYS resolved
// here (base price → tier → variant → design fee → rush → tax → shipping);
// anything the website sends as a price is ignored.
// ---------------------------------------------------------------------------
router.post('/orders', auditable('/orders'), (req, res) => {
  if (!tokenOk(req)) return res.status(401).json({ error: 'Invalid webhook token' });

  const {
    customer = {}, items = [], rush = false, fulfillment = 'ship',
    payment_method = 'Pay on invoice', notes = '', po_number = null, artwork_url = null,
    files: orderFiles = [], source_label = 'dakotaprints.com checkout',
  } = req.body || {};
  if (!customer.email || !customer.contact_name) return res.status(400).json({ error: 'contact_name and email are required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

  const taxRate = Number(getSetting('tax_rate')) / 100;
  const rushPct = Number(getSetting('rush_fee_pct')) / 100;
  const dflt = designDefaults();

  const result = db.transaction(() => {
    // 1. match or create the customer
    let cust = db.prepare('SELECT * FROM customers WHERE lower(email) = lower(?)').get(customer.email);
    if (cust) {
      db.prepare('UPDATE customers SET company=COALESCE(?,company), phone=COALESCE(?,phone), address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state), zip=COALESCE(?,zip) WHERE id=?')
        .run(customer.company || null, customer.phone || null, customer.address || null, customer.city || null, customer.state || null, customer.zip || null, cust.id);
    } else {
      const r = db.prepare(`INSERT INTO customers (company,contact_name,email,phone,address,city,state,zip,notes,source)
        VALUES (?,?,?,?,?,?,?,?,?,'website')`).run(customer.company || null, customer.contact_name, customer.email,
        customer.phone || null, customer.address || null, customer.city || null, customer.state || null, customer.zip || null, null);
      cust = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
    }

    // 2. re-price every line server-side
    let subtotal = 0;
    let designTotal = 0;
    let anyDesign = false;
    const lines = items.map((it) => {
      const p = it.sku
        ? db.prepare('SELECT * FROM products WHERE sku=? COLLATE NOCASE').get(it.sku)
        : (it.slug ? db.prepare('SELECT * FROM products WHERE slug=? COLLATE NOCASE').get(it.slug) : null);
      const qty = Math.max(1, Number(it.qty) || 1);
      const tiers = p ? tiersFor(p.id) : [];
      const label = it.variant_label || it.variant || null;
      const variant = p && label
        ? variantsFor(p.id, true).find((v) => v.label.toLowerCase() === String(label).toLowerCase()) || null
        : null;
      const unit = p ? resolveUnitPrice(p, { tiers, variant, qty }) : money(it.unit_price);
      const line = money(unit * qty);
      subtotal += line;

      const design = !!it.design_service && (!p || p.design_service_enabled);
      const designFee = design ? money(p ? (p.design_service_fee || dflt.fee) : dflt.fee) : 0;
      if (design) { anyDesign = true; designTotal += designFee; subtotal += designFee; }

      const spec = { ...(it.spec || {}) };
      if (label) spec.variant = label;
      if (it.size_breakdown) spec.size_breakdown = it.size_breakdown;

      const fileList = []
        .concat(Array.isArray(it.files) ? it.files : [])
        .concat(it.artwork_url ? [{ url: it.artwork_url, kind: 'artwork' }] : [])
        .filter((f) => f && f.url);

      return {
        p, qty, unit, line, spec, variant_label: label,
        name: it.name || p?.name || 'Custom print job',
        design, designFee, design_brief: it.design_brief || null, files: fileList,
      };
    });

    subtotal = money(subtotal);
    const rush_fee = rush ? money(subtotal * rushPct) : 0;
    const shipping = fulfillment === 'pickup' ? 0 : subtotal >= 500 ? 0 : 24.5;
    const tax = money((subtotal + rush_fee) * taxRate);
    const total = money(subtotal + rush_fee + shipping + tax);

    const turnarounds = lines.map((l) => l.p?.turnaround_days || Number(getSetting('default_turnaround')));
    const maxTurn = Math.max(...turnarounds, Number(getSetting('default_turnaround')));
    const designPad = anyDesign ? 2 : 0;
    const due = new Date(Date.now() + ((rush ? Math.ceil(maxTurn / 2) : maxTurn) + designPad) * 864e5).toISOString().slice(0, 10);

    const num = orderNumber();
    const oid = db.prepare(`INSERT INTO orders (order_number,customer_id,source,status,payment_status,payment_method,fulfillment,subtotal,rush_fee,shipping,tax,total,due_date,rush,artwork_url,notes,po_number,design_service)
      VALUES (?,?,'website','new',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      num, cust.id,
      payment_method === 'Card (demo)' ? 'paid' : payment_method === '50% deposit' ? 'deposit' : 'unpaid',
      payment_method, fulfillment, subtotal, rush_fee, shipping, tax, total, due, rush ? 1 : 0,
      artwork_url || lines.find((l) => l.files.length)?.files[0]?.url || null,
      notes || null, po_number, anyDesign ? 1 : 0,
    ).lastInsertRowid;

    const insItem = db.prepare(`INSERT INTO order_items (order_id,product_id,name,description,qty,unit_price,line_total,spec_json,design_service,design_brief,variant_label)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const insFile = db.prepare('INSERT INTO order_item_files (order_item_id,url,filename,kind) VALUES (?,?,?,?)');
    const firstItemIds = [];
    for (const l of lines) {
      const itemId = insItem.run(
        oid, l.p?.id || null, l.variant_label ? `${l.name} — ${l.variant_label}` : l.name,
        l.p?.short_description?.slice(0, 120) || l.p?.description?.slice(0, 120) || null,
        l.qty, l.unit, l.line, JSON.stringify(l.spec), l.design ? 1 : 0, l.design_brief, l.variant_label,
      ).lastInsertRowid;
      firstItemIds.push(itemId);
      for (const f of l.files) insFile.run(itemId, f.url, f.filename || f.name || null, ['artwork', 'logo', 'reference'].includes(f.kind) ? f.kind : 'artwork');
      // Order-level files (not attached to a specific line) land on the first item.
      if (l === lines[0]) {
        for (const f of (Array.isArray(orderFiles) ? orderFiles : []).filter((x) => x && x.url)) {
          insFile.run(itemId, f.url, f.filename || f.name || null, ['artwork', 'logo', 'reference'].includes(f.kind) ? f.kind : 'artwork');
        }
      }
      // Design service is billed as its own visible line so tickets and invoices show it.
      if (l.design && l.designFee > 0) {
        insItem.run(oid, l.p?.id || null, `Design service — ${l.name}`, 'Custom design created by the Dakota Prints art department',
          1, l.designFee, l.designFee, JSON.stringify({ design_service: 'yes' }), 1, l.design_brief, null);
      }
    }

    // 3. timeline + task chain (design task goes in front when requested)
    addEvent(oid, 'created', `Order received from ${source_label}${rush ? ' — RUSH requested' : ''}`, 'Website');
    if (payment_method === 'Card (demo)') addEvent(oid, 'payment', 'Payment captured (demo card) — TODO(stripe): real Checkout session', 'Website');
    if (anyDesign) {
      const briefs = lines.filter((l) => l.design).map((l) => `${l.name}: ${l.design_brief || 'no brief text supplied'}`);
      db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (?,?,?,?,?,?)')
        .run(oid, 'Create design from customer brief', 'design', 'open',
          new Date(Date.now() + 1 * 864e5).toISOString().slice(0, 10), 'Frank Ortega');
      addEvent(oid, 'design', `“Design it for me” requested (+$${designTotal.toFixed(2)}) — ${briefs.join(' | ')}`, 'Website');
    }
    createTaskChain(oid, due, 'Evie Lundberg');

    // 4. notifications + stubbed customer email/SMS
    notify('website_order', `New website order — ${cust.company || cust.contact_name}`,
      `${lines.length} line item${lines.length > 1 ? 's' : ''} · $${total.toFixed(2)}${rush ? ' · RUSH' : ''}${anyDesign ? ' · DESIGN REQUEST' : ''}`, oid);
    if (anyDesign) {
      notify('design_request', `Design request — ${cust.company || cust.contact_name}`,
        `Design fee $${designTotal.toFixed(2)} · notify ${dflt.notify_email || getSetting('notify_email')} · brief on the order`, oid);
    }
    logMessage({
      customer_id: cust.id, order_id: oid, channel: 'email', subject: `Dakota Prints — order ${num} received`,
      body: renderTemplate('order_received', { contact_name: cust.contact_name, order_number: num, total: `$${total.toFixed(2)}` }),
      template: 'order_received',
    });
    if (customer.phone) {
      logMessage({ customer_id: cust.id, order_id: oid, channel: 'sms', body: `Dakota Prints: we got order ${num}. Proof coming within one business day.`, template: 'order_received' });
    }
    db.prepare(`UPDATE customers SET total_spend = COALESCE((SELECT SUM(total) FROM orders WHERE customer_id=? AND status!='cancelled'),0) WHERE id=?`).run(cust.id, cust.id);

    return {
      order_number: num, id: oid, status: 'new', due_date: due,
      subtotal, design_total: money(designTotal), rush_fee, shipping, tax, total,
      design_service: anyDesign,
      items: lines.map((l) => ({ name: l.name, sku: l.p?.sku || null, qty: l.qty, variant_label: l.variant_label, unit_price: l.unit, line_total: l.line, design_service: !!l.design, design_fee: l.designFee })),
      track_url: `/api/public/track/${num}`,
    };
  })();

  res.locals.order_number = result.order_number;
  res.status(201).json(result);
});

// ------------------------------------------------------------------ tracking
function trackPayload(order) {
  return {
    order_number: order.order_number,
    status: order.status,
    status_label: STATUS_LABEL[order.status],
    payment_status: order.payment_status,
    fulfillment: order.fulfillment,
    due_date: order.due_date,
    rush: order.rush,
    design_service: !!order.design_service,
    total: order.total,
    tracking_number: order.tracking_number,
    created_at: order.created_at,
    items: db.prepare('SELECT id, name, qty, line_total, spec_json, variant_label, design_service FROM order_items WHERE order_id=?').all(order.id)
      .map((i) => ({
        ...i,
        spec: safeJson(i.spec_json),
        files: db.prepare('SELECT url, filename, kind FROM order_item_files WHERE order_item_id=?').all(i.id),
      })),
    events: db.prepare('SELECT type, message, created_at FROM order_events WHERE order_id=? ORDER BY datetime(created_at) DESC, id DESC').all(order.id),
  };
}

// GET /api/public/track/:orderNumber — the website's status page hits this.
// Pass ?email= to require an email match (recommended for public pages).
router.get('/track/:orderNumber', auditable(':order'), (req, res) => {
  const { email } = req.query;
  const order = db.prepare(`SELECT o.* FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
    WHERE upper(o.order_number) = upper(?) ${email ? 'AND lower(c.email) = lower(?)' : ''}`)
    .get(...(email ? [String(req.params.orderNumber).trim(), String(email).trim()] : [String(req.params.orderNumber).trim()]));
  if (!order) return res.status(404).json({ error: 'No order found for that number' });
  res.json(trackPayload(order));
});

// Legacy query form kept so existing website code keeps working.
router.get('/track', (req, res) => {
  const { order_number, email } = req.query;
  if (!order_number || !email) return res.status(400).json({ error: 'order_number and email are required' });
  const order = db.prepare(`SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE upper(o.order_number) = upper(?) AND lower(c.email) = lower(?)`).get(String(order_number).trim(), String(email).trim());
  if (!order) return res.status(404).json({ error: 'No order found for that number and email' });
  res.json(trackPayload(order));
});

export default router;
