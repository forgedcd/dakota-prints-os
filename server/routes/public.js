// PUBLIC API — this is what makes the OS a real backend for the separate
// dakotaprints.com website. Three endpoints matter to the website team:
//   POST /api/public/orders          order intake webhook (x-webhook-token)
//   GET  /api/public/products        catalog sync
//   GET  /api/public/track/:orderNumber   customer order tracking
// Every call is written to webhook_log so Settings → Website can show the last 20.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, getSetting, orderNumber, UPLOAD_DIR } from '../db.js';
import { addEvent, createTaskChain, notify, logMessage, logWebhook, renderTemplate, safeJson, STATUS_LABEL } from '../services.js';

const router = express.Router();

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

// Shop profile the website can render in its footer / checkout.
router.get('/settings', (_req, res) => {
  res.json({
    shop_name: getSetting('shop_name'),
    shop_tagline: getSetting('shop_tagline'),
    shop_phone: getSetting('shop_phone'),
    shop_email: getSetting('shop_email'),
    shop_address: getSetting('shop_address'),
    tax_rate: Number(getSetting('tax_rate')),
    rush_fee_pct: Number(getSetting('rush_fee_pct')),
    default_turnaround: Number(getSetting('default_turnaround')),
  });
});

// ---------------------------------------------------------- product sync
router.get('/products', auditable('/products'), (req, res) => {
  const { category, q } = req.query;
  let sql = 'SELECT * FROM products WHERE active = 1';
  const args = [];
  if (category && category !== 'All') { sql += ' AND category = ?'; args.push(category); }
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY category, name';
  const rows = db.prepare(sql).all(...args).map((p) => ({
    sku: p.sku, name: p.name, category: p.category, description: p.description,
    base_price: p.base_price, unit: p.unit, min_qty: p.min_qty,
    turnaround_days: p.turnaround_days, image_url: p.image_url,
    options: safeJson(p.options_json) || {},
  }));
  res.json({ count: rows.length, synced_at: new Date().toISOString(), products: rows });
});

router.get('/products/:sku', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE sku = ? AND active = 1').get(req.params.sku);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  res.json({ ...p, options: safeJson(p.options_json) || {} });
});

// Customer artwork upload (multipart). Only the relative public path is stored.
const artwork = multer({
  storage: multer.diskStorage({
    destination: (_r, _f, cb) => { fs.mkdirSync(path.resolve(UPLOAD_DIR), { recursive: true }); cb(null, path.resolve(UPLOAD_DIR)); },
    filename: (_r, file, cb) => cb(null, `art-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
});
router.post('/artwork', artwork.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// ---------------------------------------------------------------------------
// POST /api/public/orders — the headline bridge. The website checkout posts
// here with the shared webhook token; everything downstream (customer, order,
// items, timeline, task chain, notification, stubbed email) is created here.
// ---------------------------------------------------------------------------
router.post('/orders', auditable('/orders'), (req, res) => {
  const expected = getSetting('webhook_token');
  const provided = req.headers['x-webhook-token'] || req.body?.webhook_token;
  if (expected && provided !== expected) return res.status(401).json({ error: 'Invalid webhook token' });

  const { customer = {}, items = [], rush = false, fulfillment = 'ship', payment_method = 'Pay on invoice', notes = '', po_number = null, artwork_url = null, source_label = 'dakotaprints.com checkout' } = req.body || {};
  if (!customer.email || !customer.contact_name) return res.status(400).json({ error: 'contact_name and email are required' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'At least one line item is required' });

  const taxRate = Number(getSetting('tax_rate')) / 100;
  const rushPct = Number(getSetting('rush_fee_pct')) / 100;

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

    // 2. price the order server-side (never trust the website's totals)
    let subtotal = 0;
    const lines = items.map((it) => {
      const p = it.sku ? db.prepare('SELECT * FROM products WHERE sku=?').get(it.sku) : null;
      const qty = Math.max(1, Number(it.qty) || 1);
      const unit = Number(it.unit_price) || (p ? p.base_price : 0);
      const line = Math.round(unit * qty * 100) / 100;
      subtotal += line;
      return { p, qty, unit, line, name: it.name || p?.name || 'Custom print job', spec: it.spec || {} };
    });
    subtotal = Math.round(subtotal * 100) / 100;
    const rush_fee = rush ? Math.round(subtotal * rushPct * 100) / 100 : 0;
    const shipping = fulfillment === 'pickup' ? 0 : subtotal >= 500 ? 0 : 24.5;
    const tax = Math.round((subtotal + rush_fee) * taxRate * 100) / 100;
    const total = Math.round((subtotal + rush_fee + shipping + tax) * 100) / 100;

    const maxTurn = Math.max(...lines.map((l) => l.p?.turnaround_days || Number(getSetting('default_turnaround'))));
    const due = new Date(Date.now() + (rush ? Math.ceil(maxTurn / 2) : maxTurn) * 864e5).toISOString().slice(0, 10);

    const num = orderNumber();
    const oid = db.prepare(`INSERT INTO orders (order_number,customer_id,source,status,payment_status,payment_method,fulfillment,subtotal,rush_fee,shipping,tax,total,due_date,rush,artwork_url,notes,po_number)
      VALUES (?,?,'website','new',?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      num, cust.id,
      payment_method === 'Card (demo)' ? 'paid' : payment_method === '50% deposit' ? 'deposit' : 'unpaid',
      payment_method, fulfillment, subtotal, rush_fee, shipping, tax, total, due, rush ? 1 : 0, artwork_url, notes || null, po_number,
    ).lastInsertRowid;

    const insItem = db.prepare('INSERT INTO order_items (order_id,product_id,name,description,qty,unit_price,line_total,spec_json) VALUES (?,?,?,?,?,?,?,?)');
    for (const l of lines) insItem.run(oid, l.p?.id || null, l.name, l.p?.description?.slice(0, 120) || null, l.qty, l.unit, l.line, JSON.stringify(l.spec));

    // 3. timeline + auto task chain
    addEvent(oid, 'created', `Order received from ${source_label}${rush ? ' — RUSH requested' : ''}`, 'Website');
    if (payment_method === 'Card (demo)') addEvent(oid, 'payment', 'Payment captured (demo card) — TODO(stripe): real Checkout session', 'Website');
    createTaskChain(oid, due, 'Evie Lundberg');

    // 4. notification + stubbed customer email/SMS
    notify('website_order', `New website order — ${cust.company || cust.contact_name}`,
      `${lines.length} line item${lines.length > 1 ? 's' : ''} · $${total.toFixed(2)}${rush ? ' · RUSH' : ''}`, oid);
    logMessage({
      customer_id: cust.id, order_id: oid, channel: 'email', subject: `Dakota Prints — order ${num} received`,
      body: renderTemplate('order_received', { contact_name: cust.contact_name, order_number: num, total: `$${total.toFixed(2)}` }),
      template: 'order_received',
    });
    if (customer.phone) {
      logMessage({ customer_id: cust.id, order_id: oid, channel: 'sms', body: `Dakota Prints: we got order ${num}. Proof coming within one business day.`, template: 'order_received' });
    }
    db.prepare(`UPDATE customers SET total_spend = COALESCE((SELECT SUM(total) FROM orders WHERE customer_id=? AND status!='cancelled'),0) WHERE id=?`).run(cust.id, cust.id);

    return { order_number: num, id: oid, total, due_date: due, status: 'new', track_url: `/api/public/track/${num}` };
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
    total: order.total,
    tracking_number: order.tracking_number,
    created_at: order.created_at,
    items: db.prepare('SELECT name, qty, line_total, spec_json FROM order_items WHERE order_id=?').all(order.id)
      .map((i) => ({ ...i, spec: safeJson(i.spec_json) })),
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
