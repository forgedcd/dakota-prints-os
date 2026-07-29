// All authenticated admin-OS endpoints.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { db, getSetting, setSetting, UPLOAD_DIR, orderNumber } from '../db.js';
import {
  addEvent, advanceStatus, createTaskChain, getOrderFull, logMessage, notify,
  recalcCustomerSpend, renderTemplate, safeJson, STATUS_FLOW, STATUS_LABEL,
} from '../services.js';
import { renderEmail } from '../emails.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => { fs.mkdirSync(path.resolve(UPLOAD_DIR), { recursive: true }); cb(null, path.resolve(UPLOAD_DIR)); },
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } });

const money = (n) => Math.round((n || 0) * 100) / 100;

// ------------------------------------------------------------------ dashboard
router.get('/dashboard', (_req, res) => {
  const openStatuses = "('new','proof','approved','print','finishing','ready')";
  const kpi = {
    open_orders: db.prepare(`SELECT COUNT(*) n FROM orders WHERE status IN ${openStatuses}`).get().n,
    due_this_week: db.prepare(`SELECT COUNT(*) n FROM orders WHERE status IN ${openStatuses} AND date(due_date) <= date('now','+7 day')`).get().n,
    revenue_month: money(db.prepare(`SELECT SUM(total) s FROM orders WHERE status != 'cancelled' AND strftime('%Y-%m',created_at) = strftime('%Y-%m','now')`).get().s),
    unpaid_balance: money(db.prepare(`SELECT SUM(CASE WHEN payment_status='deposit' THEN total/2 ELSE total END) s FROM orders WHERE payment_status != 'paid' AND status NOT IN ('cancelled')`).get().s),
    rush_jobs: db.prepare(`SELECT COUNT(*) n FROM orders WHERE rush = 1 AND status IN ${openStatuses}`).get().n,
  };
  const websiteFeed = db.prepare(`SELECT o.id, o.order_number, o.total, o.status, o.rush, o.created_at, c.company, c.contact_name
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.source='website' ORDER BY datetime(o.created_at) DESC, o.id DESC LIMIT 8`).all();
  const tasksToday = db.prepare(`SELECT t.*, o.order_number FROM tasks t LEFT JOIN orders o ON o.id=t.order_id
    WHERE t.status='open' AND date(t.due_date) <= date('now') ORDER BY date(t.due_date) LIMIT 8`).all();
  const revenueByWeek = db.prepare(`SELECT strftime('%Y-%W', created_at) wk, MIN(date(created_at)) start, SUM(total) total, COUNT(*) orders
    FROM orders WHERE status != 'cancelled' AND date(created_at) >= date('now','-70 day') GROUP BY wk ORDER BY wk`).all()
    .map((r) => ({ ...r, total: money(r.total) }));
  const byCategory = db.prepare(`SELECT p.category, SUM(oi.line_total) total, SUM(oi.qty) qty FROM order_items oi
    JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled'
    GROUP BY p.category ORDER BY total DESC`).all().map((r) => ({ ...r, total: money(r.total) }));
  const threshold = Number(getSetting('low_stock_threshold') || 48);
  const lowStock = db.prepare('SELECT id,name,sku,stock FROM products WHERE stock IS NOT NULL AND stock <= ? ORDER BY stock').all(threshold * 4);
  const notifications = db.prepare('SELECT * FROM notifications ORDER BY datetime(created_at) DESC, id DESC LIMIT 10').all();
  const boardCounts = Object.fromEntries(STATUS_FLOW.map((s) => [s, db.prepare('SELECT COUNT(*) n FROM orders WHERE status=?').get(s).n]));
  res.json({ kpi, websiteFeed, tasksToday, revenueByWeek, byCategory, lowStock, notifications, boardCounts, threshold });
});

// --------------------------------------------------------------------- orders
router.get('/orders', (req, res) => {
  const { status, source, payment, q, from, board } = req.query;
  let sql = `SELECT o.*, c.company, c.contact_name, c.email,
    (SELECT COUNT(*) FROM order_items i WHERE i.order_id=o.id) item_count,
    (SELECT COUNT(*) FROM tasks t WHERE t.order_id=o.id AND t.status='open') open_tasks
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE 1=1`;
  const args = [];
  if (status && status !== 'all') { sql += ' AND o.status = ?'; args.push(status); }
  if (source && source !== 'all') { sql += ' AND o.source = ?'; args.push(source); }
  if (payment && payment !== 'all') { sql += ' AND o.payment_status = ?'; args.push(payment); }
  if (from) { sql += " AND date(o.created_at) >= date(?)"; args.push(from); }
  if (q) { sql += ' AND (o.order_number LIKE ? OR c.company LIKE ? OR c.contact_name LIKE ? OR c.email LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY datetime(o.created_at) DESC, o.id DESC';
  if (board) sql = sql.replace('WHERE 1=1', "WHERE o.status != 'cancelled'");
  res.json(db.prepare(sql).all(...args));
});

router.get('/orders/:id', (req, res) => {
  const o = getOrderFull(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json(o);
});

router.patch('/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const { status, payment_status, notes, tracking_number, due_date, rush } = req.body || {};
  if (payment_status && payment_status !== order.payment_status) {
    db.prepare('UPDATE orders SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(payment_status, id);
    addEvent(id, 'payment', `Payment marked ${payment_status}`, req.user.name);
    if (payment_status === 'paid') {
      const t = db.prepare("SELECT id FROM tasks WHERE order_id=? AND type='payment' AND status='open'").get(id);
      if (t) db.prepare("UPDATE tasks SET status='done', completed_at=CURRENT_TIMESTAMP WHERE id=?").run(t.id);
    }
  }
  if (notes !== undefined) db.prepare('UPDATE orders SET notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(notes, id);
  if (tracking_number !== undefined) db.prepare('UPDATE orders SET tracking_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(tracking_number, id);
  if (due_date) db.prepare('UPDATE orders SET due_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(due_date, id);
  if (rush !== undefined) db.prepare('UPDATE orders SET rush=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(rush ? 1 : 0, id);
  if (status && status !== order.status) advanceStatus(id, status, req.user.name);
  recalcCustomerSpend(order.customer_id);
  res.json(getOrderFull(id));
});

router.post('/orders/:id/events', (req, res) => {
  const { message, type = 'note' } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  addEvent(Number(req.params.id), type, message, req.user.name);
  res.json(getOrderFull(req.params.id));
});

router.post('/orders/:id/message', (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const cust = db.prepare('SELECT * FROM customers WHERE id=?').get(order.customer_id);
  const { channel = 'email', template = 'order_received', body } = req.body || {};
  const text = body || renderTemplate(template, {
    contact_name: cust?.contact_name, order_number: order.order_number,
    total: `$${order.total.toFixed(2)}`, deposit: `$${(order.total / 2).toFixed(2)}`,
    tracking_number: order.tracking_number || 'pickup', last_product: 'your last run',
  });
  logMessage({ customer_id: cust?.id, order_id: id, channel, subject: channel === 'email' ? `Dakota Prints — ${order.order_number}` : null, body: text, template });
  addEvent(id, 'message', `${channel === 'sms' ? 'SMS' : 'Email'} sent to ${cust?.contact_name || 'customer'} (${template})`, req.user.name);
  res.json(getOrderFull(id));
});

router.delete('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
  recalcCustomerSpend(order.customer_id);
  res.json({ deleted: true });
});

// Manual order creation from inside the OS (rep / phone orders)
router.post('/orders', (req, res) => {
  const { customer_id, source = 'rep', items = [], rush = 0, notes = '', fulfillment = 'pickup' } = req.body || {};
  if (!customer_id || items.length === 0) return res.status(400).json({ error: 'customer_id and items required' });
  const taxRate = Number(getSetting('tax_rate')) / 100;
  const rushPct = Number(getSetting('rush_fee_pct')) / 100;
  let subtotal = 0;
  const lines = items.map((it) => {
    const p = db.prepare('SELECT * FROM products WHERE id=? OR sku=?').get(it.product_id || 0, it.sku || '');
    const qty = Math.max(1, Number(it.qty) || 1);
    const unit = Number(it.unit_price) || p?.base_price || 0;
    const line = money(unit * qty); subtotal += line;
    return { p, qty, unit, line };
  });
  const rush_fee = rush ? money(subtotal * rushPct) : 0;
  const tax = money((subtotal + rush_fee) * taxRate);
  const total = money(subtotal + rush_fee + tax);
  const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const num = orderNumber();
  const oid = db.prepare(`INSERT INTO orders (order_number,customer_id,source,status,payment_status,payment_method,fulfillment,subtotal,rush_fee,shipping,tax,total,due_date,rush,notes)
    VALUES (?,?,?,'new','unpaid','Pay on invoice',?,?,?,0,?,?,?,?,?)`)
    .run(num, customer_id, source, fulfillment, money(subtotal), rush_fee, tax, total, due, rush ? 1 : 0, notes || null).lastInsertRowid;
  const insItem = db.prepare('INSERT INTO order_items (order_id,product_id,name,qty,unit_price,line_total,spec_json) VALUES (?,?,?,?,?,?,?)');
  for (const l of lines) insItem.run(oid, l.p?.id || null, l.p?.name || 'Custom job', l.qty, l.unit, l.line, '{}');
  addEvent(oid, 'created', `Order entered by ${req.user.name} (${source})`, req.user.name);
  createTaskChain(oid, due, req.user.name);
  notify('order', `New ${source} order — ${db.prepare('SELECT company,contact_name FROM customers WHERE id=?').get(customer_id)?.company || 'customer'}`, `$${total.toFixed(2)}`, oid);
  recalcCustomerSpend(customer_id);
  res.status(201).json(getOrderFull(oid));
});

// ------------------------------------------------------------------ customers
router.get('/customers', (req, res) => {
  const { q } = req.query;
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id) order_count,
    (SELECT MAX(date(o.created_at)) FROM orders o WHERE o.customer_id=c.id) last_order
    FROM customers c WHERE 1=1`;
  const args = [];
  if (q) { sql += ' AND (c.company LIKE ? OR c.contact_name LIKE ? OR c.email LIKE ? OR c.city LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY c.total_spend DESC';
  res.json(db.prepare(sql).all(...args));
});

router.get('/customers/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Customer not found' });
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY datetime(created_at) DESC').all(c.id);
  res.json({
    ...c,
    derived_source: orders.length > 1 ? 'repeat' : c.source,
    orders,
    messages: db.prepare('SELECT * FROM messages WHERE customer_id=? ORDER BY datetime(created_at) DESC LIMIT 25').all(c.id),
    activity: db.prepare(`SELECT e.* , o.order_number FROM order_events e JOIN orders o ON o.id=e.order_id
      WHERE o.customer_id=? ORDER BY datetime(e.created_at) DESC LIMIT 25`).all(c.id),
  });
});

router.patch('/customers/:id', (req, res) => {
  const fields = ['company', 'contact_name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'notes', 'source'];
  const sets = [], args = [];
  for (const f of fields) if (req.body[f] !== undefined) { sets.push(`${f}=?`); args.push(req.body[f]); }
  if (sets.length) { args.push(req.params.id); db.prepare(`UPDATE customers SET ${sets.join(',')} WHERE id=?`).run(...args); }
  res.json(db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id));
});

router.post('/customers', (req, res) => {
  const { company, contact_name, email, phone, city, state, zip, address, notes, source = 'rep' } = req.body || {};
  if (!contact_name || !email) return res.status(400).json({ error: 'contact_name and email required' });
  const r = db.prepare(`INSERT INTO customers (company,contact_name,email,phone,address,city,state,zip,notes,source) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(company || null, contact_name, email, phone || null, address || null, city || null, state || null, zip || null, notes || null, source);
  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid));
});

router.delete('/customers/:id', (req, res) => {
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  res.json({ deleted: true });
});

// ------------------------------------------------------------------- products
router.get('/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY category, name').all();
  const threshold = Number(getSetting('low_stock_threshold') || 48);
  res.json(rows.map((p) => ({ ...p, options: safeJson(p.options_json) || {}, low_stock: p.stock !== null && p.stock <= threshold })));
});

function productPayload(b) {
  return {
    sku: b.sku, name: b.name, category: b.category, description: b.description || '',
    base_price: Number(b.base_price) || 0, unit: b.unit || 'each',
    min_qty: Number(b.min_qty) || 1, turnaround_days: Number(b.turnaround_days) || 7,
    image_url: b.image_url || null, stock: b.stock === '' || b.stock === null || b.stock === undefined ? null : Number(b.stock),
    active: b.active === false || b.active === 0 || b.active === '0' ? 0 : 1,
    options_json: typeof b.options_json === 'string' ? b.options_json : JSON.stringify(b.options || {}),
  };
}

router.post('/products', (req, res) => {
  const p = productPayload(req.body || {});
  if (!p.sku || !p.name) return res.status(400).json({ error: 'sku and name required' });
  const r = db.prepare(`INSERT INTO products (sku,name,category,description,base_price,unit,min_qty,turnaround_days,image_url,stock,active,options_json)
    VALUES (@sku,@name,@category,@description,@base_price,@unit,@min_qty,@turnaround_days,@image_url,@stock,@active,@options_json)`).run(p);
  res.status(201).json(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/products/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });
  const p = productPayload({ ...existing, ...req.body });
  db.prepare(`UPDATE products SET sku=@sku,name=@name,category=@category,description=@description,base_price=@base_price,unit=@unit,
    min_qty=@min_qty,turnaround_days=@turnaround_days,image_url=@image_url,stock=@stock,active=@active,options_json=@options_json WHERE id=@id`)
    .run({ ...p, id: Number(req.params.id) });
  const threshold = Number(getSetting('low_stock_threshold') || 48);
  if (p.stock !== null && p.stock <= threshold) {
    const dupe = db.prepare("SELECT id FROM tasks WHERE title=? AND status='open'").get(`Restock blanks: ${p.name}`);
    if (!dupe) {
      db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (NULL,?,?,?,?,?)')
        .run(`Restock blanks: ${p.name}`, 'followup', 'open', new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), req.user.name);
      notify('low_stock', `Blank stock low — ${p.name}`, `${p.stock} on hand, at or below the ${threshold} reorder point.`, null);
    }
  }
  res.json(db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id));
});

router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ deleted: true });
});

router.post('/uploads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` }); // DB stores only this relative path
});

// ---------------------------------------------------------------------- tasks
router.get('/tasks', (_req, res) => {
  const rows = db.prepare(`SELECT t.*, o.order_number, o.status order_status, c.company, c.contact_name
    FROM tasks t LEFT JOIN orders o ON o.id=t.order_id LEFT JOIN customers c ON c.id=o.customer_id
    ORDER BY t.status, date(t.due_date)`).all();
  res.json(rows);
});

router.patch('/tasks/:id', (req, res) => {
  const { status, title, due_date, assigned_to } = req.body || {};
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  if (status) db.prepare('UPDATE tasks SET status=?, completed_at=? WHERE id=?').run(status, status === 'done' ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null, t.id);
  if (title) db.prepare('UPDATE tasks SET title=? WHERE id=?').run(title, t.id);
  if (due_date) db.prepare('UPDATE tasks SET due_date=? WHERE id=?').run(due_date, t.id);
  if (assigned_to) db.prepare('UPDATE tasks SET assigned_to=? WHERE id=?').run(assigned_to, t.id);
  if (status === 'done' && t.order_id) addEvent(t.order_id, 'task', `Task completed: ${t.title}`, req.user.name);
  res.json(db.prepare('SELECT * FROM tasks WHERE id=?').get(t.id));
});

router.post('/tasks', (req, res) => {
  const { title, type = 'followup', due_date, assigned_to, order_id = null } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const r = db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (?,?,?,?,?,?)')
    .run(order_id, title, type, 'open', due_date || new Date().toISOString().slice(0, 10), assigned_to || req.user.name);
  res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id=?').get(r.lastInsertRowid));
});

router.delete('/tasks/:id', (req, res) => { db.prepare('DELETE FROM tasks WHERE id=?').run(req.params.id); res.json({ deleted: true }); });

// ------------------------------------------------------- messages + notifications
router.get('/messages', (_req, res) => {
  res.json(db.prepare(`SELECT m.*, c.company, c.contact_name, c.email, o.order_number
    FROM messages m LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN orders o ON o.id=m.order_id
    ORDER BY datetime(m.created_at) DESC, m.id DESC LIMIT 200`).all());
});

router.post('/messages', (req, res) => {
  const { customer_id, order_id = null, channel = 'email', template = null, subject = null, body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body required' });
  logMessage({ customer_id, order_id, channel, subject, body, template });
  res.status(201).json({ sent: true });
});

router.get('/notifications', (_req, res) => {
  res.json(db.prepare('SELECT * FROM notifications ORDER BY datetime(created_at) DESC, id DESC LIMIT 60').all());
});
router.post('/notifications/read', (req, res) => {
  if (req.body?.id) db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(req.body.id);
  else db.prepare('UPDATE notifications SET read=1').run();
  res.json({ ok: true });
});

// -------------------------------------------------------------------- reports
function reportData() {
  const byMonth = db.prepare(`SELECT strftime('%Y-%m',created_at) month, SUM(total) revenue, COUNT(*) orders
    FROM orders WHERE status!='cancelled' GROUP BY month ORDER BY month`).all().map((r) => ({ ...r, revenue: money(r.revenue) }));
  const topProducts = db.prepare(`SELECT oi.name, SUM(oi.qty) qty, SUM(oi.line_total) revenue FROM order_items oi
    JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled' GROUP BY oi.name ORDER BY revenue DESC LIMIT 10`).all()
    .map((r) => ({ ...r, revenue: money(r.revenue) }));
  const topCustomers = db.prepare(`SELECT c.company, c.contact_name, COUNT(o.id) orders, SUM(o.total) revenue FROM customers c
    JOIN orders o ON o.customer_id=c.id WHERE o.status!='cancelled' GROUP BY c.id ORDER BY revenue DESC LIMIT 10`).all()
    .map((r) => ({ ...r, revenue: money(r.revenue) }));
  const bySource = db.prepare(`SELECT source, COUNT(*) orders, SUM(total) revenue FROM orders WHERE status!='cancelled' GROUP BY source`).all()
    .map((r) => ({ ...r, revenue: money(r.revenue) }));
  const byCategory = db.prepare(`SELECT p.category, SUM(oi.line_total) revenue, SUM(oi.qty) qty FROM order_items oi
    JOIN products p ON p.id=oi.product_id JOIN orders o ON o.id=oi.order_id WHERE o.status!='cancelled'
    GROUP BY p.category ORDER BY revenue DESC`).all().map((r) => ({ ...r, revenue: money(r.revenue) }));
  const turn = db.prepare(`SELECT AVG(julianday(updated_at)-julianday(created_at)) avg_days FROM orders WHERE status IN ('completed','shipped')`).get();
  const rush = db.prepare(`SELECT SUM(rush) r, COUNT(*) n FROM orders WHERE status!='cancelled'`).get();
  return {
    byMonth, topProducts, topCustomers, bySource, byCategory,
    avg_turnaround: Math.round((turn.avg_days || 0) * 10) / 10,
    rush_pct: rush.n ? Math.round((rush.r / rush.n) * 1000) / 10 : 0,
    total_revenue: money(byMonth.reduce((a, b) => a + b.revenue, 0)),
  };
}
router.get('/reports', (_req, res) => res.json(reportData()));

router.get('/reports/export.csv', (req, res) => {
  const rows = db.prepare(`SELECT o.order_number, o.created_at, o.status, o.source, o.payment_status, o.rush,
    c.company, c.contact_name, c.email, o.subtotal, o.rush_fee, o.shipping, o.tax, o.total, o.due_date
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY datetime(o.created_at) DESC`).all();
  const head = Object.keys(rows[0] || { order_number: '' });
  const csv = [head.join(','), ...rows.map((r) => head.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="dakota-prints-orders.csv"');
  res.send(csv);
});

// ------------------------------------------------------------------- settings
const SETTING_KEYS = ['shop_name', 'shop_tagline', 'shop_phone', 'shop_email', 'shop_address', 'tax_rate', 'rush_fee_pct',
  'default_turnaround', 'notify_email', 'low_stock_threshold', 'website_url', 'tpl_order_received', 'tpl_proof_ready', 'tpl_deposit_reminder',
  'tpl_ready_pickup', 'tpl_shipped', 'tpl_reorder_followup'];

router.get('/settings', (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k, '');
  out.webhook_token = getSetting('webhook_token');
  out.webhook_url = `${req.protocol}://${req.get('host')}/api/public/orders`;
  out.users = db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id').all();
  res.json(out);
});

router.put('/settings', (req, res) => {
  for (const k of SETTING_KEYS) if (req.body[k] !== undefined) setSetting(k, req.body[k]);
  const out = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k, '');
  res.json(out);
});

// ------------------------------------------------- website / webhook integration
const LOCAL_BASE = `http://127.0.0.1:${process.env.PORT || 5000}`;

router.get('/webhooks', (req, res) => {
  const log = db.prepare('SELECT * FROM webhook_log ORDER BY datetime(created_at) DESC, id DESC LIMIT 20').all();
  const counts = db.prepare(`SELECT
      SUM(CASE WHEN status < 400 THEN 1 ELSE 0 END) ok,
      SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) failed,
      COUNT(*) total FROM webhook_log`).get();
  const last = db.prepare("SELECT created_at FROM webhook_log WHERE endpoint LIKE 'POST%orders' ORDER BY id DESC LIMIT 1").get();
  res.json({
    webhook_url: `${req.protocol}://${req.get('host')}/api/public/orders`,
    products_url: `${req.protocol}://${req.get('host')}/api/public/products`,
    track_url: `${req.protocol}://${req.get('host')}/api/public/track/DP-00000000-0000`,
    webhook_token: getSetting('webhook_token'),
    website_url: getSetting('website_url', ''),
    env_website_url: process.env.WEBSITE_URL || null,
    token_from_env: !!process.env.OS_WEBHOOK_TOKEN,
    last_intake_at: last?.created_at || null,
    counts,
    log,
  });
});

router.post('/webhooks/regenerate', (req, res) => {
  const token = `dp_${crypto.randomBytes(16).toString('hex')}`;
  setSetting('webhook_token', token);
  notify('integration', 'Webhook token regenerated', `${req.user.name} rotated the website intake token. Update the website env var.`, null);
  res.json({ webhook_token: token });
});

// Built-in tester: POSTs a realistic sample order to our own intake endpoint so a
// demo works with no website running.
router.post('/webhooks/test', async (req, res) => {
  const stamp = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const payload = {
    source_label: 'Settings → Send test order',
    customer: {
      company: 'Williston Ace Hardware', contact_name: 'Test Customer', email: 'testorder@dakotaprints.com',
      phone: '701-713-4401', address: '905 6th Ave SE', city: 'Williston', state: 'ND', zip: '58801',
    },
    items: [
      { sku: 'SP-TEE-1C', qty: 48, spec: { size_breakdown: { S: 6, M: 12, L: 18, XL: 12 }, ink_colors: 'White + Red', placement: 'Front, 11" wide' } },
      { sku: 'SGN-YARD', qty: 10, spec: { sides: 'Single-sided', stakes: 'Include H-stakes' } },
    ],
    rush: true, fulfillment: 'ship', payment_method: '50% deposit',
    notes: `Webhook test fired from Settings at ${stamp}.`,
  };
  try {
    const r = await fetch(`${LOCAL_BASE}/api/public/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-token': getSetting('webhook_token') },
      body: JSON.stringify(payload),
    });
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json(body);
    res.status(201).json({ ...body, tested_endpoint: '/api/public/orders' });
  } catch (e) {
    res.status(502).json({ error: `Could not reach the intake endpoint: ${e.message}` });
  }
});

// Connection check against the WEBSITE_URL product-sync target.
router.get('/website/status', async (_req, res) => {
  const url = getSetting('website_url', '');
  if (!url) return res.json({ configured: false, reachable: false, message: 'No WEBSITE_URL configured' });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { method: 'GET', signal: ctrl.signal, redirect: 'follow' });
    res.json({ configured: true, reachable: r.ok, http_status: r.status, url, checked_at: new Date().toISOString() });
  } catch (e) {
    res.json({ configured: true, reachable: false, url, message: e.name === 'AbortError' ? 'Timed out after 4s' : e.message, checked_at: new Date().toISOString() });
  } finally { clearTimeout(t); }
});

// HTML email stub preview — same lockup header the real Resend template will use.
router.get('/email-preview', (req, res) => {
  const key = String(req.query.template || 'tpl_order_received');
  const order = db.prepare("SELECT o.*, c.contact_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.id DESC LIMIT 1").get();
  const body = renderTemplate(key.replace(/^tpl_/, ''), {
    contact_name: order?.contact_name || 'Dale', order_number: order?.order_number || 'DP-20260728-1042',
    total: `$${(order?.total || 0).toFixed(2)}`, deposit: `$${((order?.total || 0) / 2).toFixed(2)}`,
    tracking_number: order?.tracking_number || '1Z999AA10123456', last_product: 'Screen-Printed Tee — 1 Color',
  });
  res.setHeader('Content-Type', 'text/html');
  res.send(renderEmail({
    origin: `${req.protocol}://${req.get('host')}`,
    heading: key.replace(/^tpl_/, '').replace(/_/g, ' '),
    body,
    shop: {
      name: getSetting('shop_name'), address: getSetting('shop_address'),
      phone: getSetting('shop_phone'), email: getSetting('shop_email'),
    },
  }));
});

router.get('/meta', (_req, res) => {
  res.json({ statuses: STATUS_FLOW, labels: STATUS_LABEL, categories: db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all().map((r) => r.category) });
});

export default router;
