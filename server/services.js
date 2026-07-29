// Shared order-lifecycle logic used by both the admin OS and the public website bridge.
import { db, getSetting } from './db.js';

export const STATUS_FLOW = ['new', 'proof', 'approved', 'print', 'finishing', 'ready', 'shipped', 'completed'];
export const STATUS_LABEL = {
  new: 'New', proof: 'Proof', approved: 'Approved', print: 'Print',
  finishing: 'Finishing', ready: 'Ready', shipped: 'Shipped / Picked up',
  completed: 'Completed', cancelled: 'Cancelled',
};
const STATUS_TASK_TYPE = { proof: 'payment', approved: 'proof', print: 'proof', finishing: 'print', ready: 'finishing', shipped: 'ship', completed: 'ship' };
const STATUS_MESSAGE = {
  proof: { template: 'proof_ready', channel: 'email', subject: 'Your Dakota Prints proof is ready' },
  print: { template: 'order_update', channel: 'email', subject: 'Your job is on the press' },
  ready: { template: 'ready_pickup', channel: 'sms', subject: null },
  shipped: { template: 'shipped', channel: 'email', subject: 'Your Dakota Prints order shipped' },
};

export const TASK_CHAIN = [
  { type: 'payment', title: 'Confirm payment / collect deposit', offset: -6 },
  { type: 'proof', title: 'Build proof and send for approval', offset: -5 },
  { type: 'print', title: 'Print / production run', offset: -3 },
  { type: 'finishing', title: 'Finishing, fold and count', offset: -2 },
  { type: 'ship', title: 'Ready for pickup / ship with tracking', offset: -1 },
];

const dateOnly = (d) => d.toISOString().slice(0, 10);

export function addEvent(orderId, type, message, actor = 'System') {
  db.prepare('INSERT INTO order_events (order_id,type,message,actor) VALUES (?,?,?,?)').run(orderId, type, message, actor);
}

/** Every inbound public/website call is recorded so Frank can audit the bridge from Settings. */
export function logWebhook({ endpoint, status, order_number = null, ip = null, payload_preview = null }) {
  db.prepare('INSERT INTO webhook_log (endpoint,status,order_number,ip,payload_preview) VALUES (?,?,?,?,?)')
    .run(endpoint, status, order_number, ip, (payload_preview || '').slice(0, 400) || null);
  db.prepare('DELETE FROM webhook_log WHERE id NOT IN (SELECT id FROM webhook_log ORDER BY id DESC LIMIT 200)').run();
}

export function notify(type, title, body, orderId = null) {
  db.prepare('INSERT INTO notifications (type,title,body,order_id) VALUES (?,?,?,?)').run(type, title, body, orderId);
}

export function renderTemplate(key, vars) {
  const raw = getSetting(`tpl_${key}`) || '';
  return raw.replace(/{{\s*(\w+)\s*}}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
}

export function logMessage({ customer_id, order_id, channel = 'email', subject = null, body, template = null }) {
  db.prepare('INSERT INTO messages (customer_id,order_id,channel,direction,subject,body,template) VALUES (?,?,?,?,?,?,?)')
    .run(customer_id || null, order_id || null, channel, 'out', subject, body, template);
  // TODO(resend/twilio): swap this stub for a real send. See README → Integrations.
}

export function createTaskChain(orderId, dueDate, assignee = 'Evie Lundberg') {
  const base = dueDate ? new Date(dueDate) : new Date(Date.now() + 7 * 864e5);
  const stmt = db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (?,?,?,?,?,?)');
  for (const t of TASK_CHAIN) {
    const d = new Date(base); d.setDate(d.getDate() + t.offset);
    stmt.run(orderId, t.title, t.type, 'open', dateOnly(d), assignee);
  }
}

export function getOrderFull(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  return {
    ...order,
    customer: order.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(order.customer_id) : null,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id).map((i) => ({ ...i, spec: safeJson(i.spec_json) })),
    events: db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY datetime(created_at) DESC, id DESC').all(id),
    tasks: db.prepare('SELECT * FROM tasks WHERE order_id = ? ORDER BY id').all(id),
    messages: db.prepare('SELECT * FROM messages WHERE order_id = ? ORDER BY datetime(created_at) DESC').all(id),
  };
}

export function safeJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

export function advanceStatus(id, nextStatus, actor = 'System') {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  const prev = order.status;
  if (prev === nextStatus) return getOrderFull(id);

  let tracking = order.tracking_number;
  if (nextStatus === 'shipped' && !tracking && order.fulfillment !== 'pickup') {
    tracking = '1Z999AA1' + Math.floor(1e7 + Math.random() * 8e7);
  }
  db.prepare('UPDATE orders SET status=?, tracking_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(nextStatus, tracking, id);

  addEvent(id, nextStatus === 'cancelled' ? 'cancelled' : 'status',
    `Status moved ${STATUS_LABEL[prev] || prev} → ${STATUS_LABEL[nextStatus] || nextStatus}`, actor);

  // complete the matching task for the stage we just left
  const taskType = STATUS_TASK_TYPE[nextStatus];
  if (taskType) {
    const open = db.prepare("SELECT * FROM tasks WHERE order_id=? AND type=? AND status='open' ORDER BY id LIMIT 1").get(id, taskType);
    if (open) db.prepare("UPDATE tasks SET status='done', completed_at=CURRENT_TIMESTAMP WHERE id=?").run(open.id);
  }
  if (nextStatus === 'completed') {
    db.prepare("UPDATE tasks SET status='done', completed_at=CURRENT_TIMESTAMP WHERE order_id=? AND status='open'").run(id);
    db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (?,?,?,?,?,?)')
      .run(id, 'Reorder follow-up call', 'followup', 'open', dateOnly(new Date(Date.now() + 30 * 864e5)), actor);
  }

  const cust = order.customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(order.customer_id) : null;
  const msg = STATUS_MESSAGE[nextStatus];
  if (msg && cust) {
    const body = msg.template === 'order_update'
      ? `${cust.contact_name}, ${order.order_number} is on the press now. We'll text when it's ready.`
      : renderTemplate(msg.template, {
          contact_name: cust.contact_name, order_number: order.order_number,
          total: `$${order.total.toFixed(2)}`, tracking_number: tracking || 'pickup',
          deposit: `$${(order.total / 2).toFixed(2)}`,
        });
    logMessage({ customer_id: cust.id, order_id: id, channel: msg.channel, subject: msg.subject, body, template: msg.template });
    notify('customer_notified', `${msg.channel === 'sms' ? 'SMS' : 'Email'} sent — ${order.order_number}`,
      `${STATUS_LABEL[nextStatus]} notice to ${cust.contact_name}${cust.company ? ` (${cust.company})` : ''}`, id);
  }
  return getOrderFull(id);
}

export function recalcCustomerSpend(customerId) {
  if (!customerId) return;
  db.prepare(`UPDATE customers SET total_spend = COALESCE((SELECT SUM(total) FROM orders WHERE customer_id=? AND status!='cancelled'),0) WHERE id=?`)
    .run(customerId, customerId);
}
