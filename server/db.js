// Dakota Prints OS — SQLite schema, migrations and demo seed.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

const DB_PATH = process.env.DATABASE_PATH || './data/dakota.db';
export const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });
fs.mkdirSync(path.resolve(UPLOAD_DIR), { recursive: true });

export const db = new Database(path.resolve(DB_PATH));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rep',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT,
  contact_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  total_spend REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  base_price REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'each',
  min_qty INTEGER NOT NULL DEFAULT 1,
  turnaround_days INTEGER NOT NULL DEFAULT 7,
  image_url TEXT,
  stock INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  options_json TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'new',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  payment_method TEXT,
  fulfillment TEXT DEFAULT 'ship',
  subtotal REAL NOT NULL DEFAULT 0,
  rush_fee REAL NOT NULL DEFAULT 0,
  shipping REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  rush INTEGER NOT NULL DEFAULT 0,
  artwork_url TEXT,
  notes TEXT,
  po_number TEXT,
  tracking_number TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  name TEXT NOT NULL,
  description TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  spec_json TEXT
);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'followup',
  status TEXT NOT NULL DEFAULT 'open',
  due_date TEXT,
  assigned_to TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  order_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  order_id INTEGER,
  channel TEXT NOT NULL DEFAULT 'email',
  direction TEXT NOT NULL DEFAULT 'out',
  subject TEXT,
  body TEXT,
  template TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  status INTEGER NOT NULL,
  order_number TEXT,
  ip TEXT,
  payload_preview TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
`);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function orderNumber(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(1000 + Math.random() * 9000));
  return `DP-${day}-${seq}`;
}

const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const daysAhead = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const dateOnly = (d) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------- seed
const PRODUCTS = [
  { sku: 'SP-TEE-1C', name: 'Screen-Printed Tee — 1 Color', category: 'Apparel', base_price: 8.5, unit: 'per shirt', min_qty: 24, turnaround_days: 7, stock: 480,
    description: 'Gildan 5000 heavy cotton tee, one-color plastisol print. The workhorse of every team, crew and fundraiser in the tri-county area.',
    image_url: '/brand/products/screenprint-tee.jpg',
    options: { sizes: ['S','M','L','XL','2XL (+$2.00)','3XL (+$3.50)'], garment_colors: ['White','Black','Athletic Heather','Sport Grey','Navy','Cardinal Red','Forest Green','Safety Orange'], ink_colors: ['White','Black','Red','Royal','Gold','Cyan','Magenta'], placements: ['Front','Back','Left chest','Sleeve'] } },
  { sku: 'SP-TEE-3C', name: 'Screen-Printed Tee — 3 Color', category: 'Apparel', base_price: 12.75, unit: 'per shirt', min_qty: 24, turnaround_days: 8, stock: 320,
    description: 'Three-color spot print on 100% cotton. Registered on our six-station manual press — good for logos with an outline plus fill.',
    image_url: '/brand/products/press-run.jpg',
    options: { sizes: ['S','M','L','XL','2XL (+$2.00)','3XL (+$3.50)'], garment_colors: ['White','Black','Sand','Navy','Maroon','Royal'], ink_colors: ['White','Black','Red','Royal','Gold','Cyan','Magenta','Kelly'], placements: ['Front','Back','Front + back (+$3.00)','Left chest'] } },
  { sku: 'DTF-TEE', name: 'DTF Full-Color Transfer Tee', category: 'Apparel', base_price: 14.0, unit: 'per shirt', min_qty: 6, turnaround_days: 4, stock: 210,
    description: 'Direct-to-film transfer — photographic full color with no screen charges. Best pick for small runs and gradient artwork.',
    image_url: '/brand/products/dtf-tee.jpg',
    options: { sizes: ['YS','YM','YL','S','M','L','XL','2XL (+$2.00)','3XL (+$3.50)'], garment_colors: ['White','Black','Heather Grey','Navy'], placements: ['Front 11x14','Left chest 4x4','Back 11x14'] } },
  { sku: 'EMB-POLO', name: 'Embroidered Performance Polo', category: 'Apparel', base_price: 22.0, unit: 'each', min_qty: 12, turnaround_days: 10, stock: 140,
    description: 'Moisture-wicking polo with up to 8,000-stitch left-chest logo. Digitizing is a one-time $25 setup, free on reorders.',
    image_url: '/brand/products/embroidered-polo.jpg',
    options: { sizes: ['S','M','L','XL','2XL (+$2.50)','3XL (+$4.00)'], garment_colors: ['White','Black','Navy','Steel Grey','Red'], placements: ['Left chest','Right chest','Left sleeve'], thread_colors: ['White','Black','Red','Gold','Silver','Navy'] } },
  { sku: 'EMB-CAP', name: 'Embroidered Cap', category: 'Apparel', base_price: 18.5, unit: 'each', min_qty: 12, turnaround_days: 10, stock: 260,
    description: 'Structured or trucker-mesh cap, 3D puff or flat embroidery on the front panel. Pheasant-season favorite.',
    image_url: '/brand/products/embroidered-cap.jpg',
    options: { styles: ['Structured 6-panel','Trucker mesh','Unstructured dad hat'], garment_colors: ['Black','Charcoal/Black','Realtree Camo','Navy/White','Red/White'], placements: ['Front center','Front left','Back'], thread_colors: ['White','Black','Red','Gold','Cream'] } },
  { sku: 'SP-HOOD', name: 'Hoodie — Screen Print', category: 'Apparel', base_price: 28.0, unit: 'each', min_qty: 12, turnaround_days: 9, stock: 165,
    description: '50/50 pullover hooded sweatshirt, up to two print colors included. Add a hood-liner or sleeve hit for a few dollars more.',
    image_url: '/brand/products/hoodie.jpg',
    options: { sizes: ['S','M','L','XL','2XL (+$3.00)','3XL (+$5.00)'], garment_colors: ['Black','Sport Grey','Navy','Maroon','Sand'], ink_colors: ['White','Black','Gold','Red'], placements: ['Front','Back','Left chest','Sleeve'] } },
  { sku: 'VIN-DECAL', name: 'Custom Vinyl Decal', category: 'Vinyl & Decals', base_price: 6.0, unit: 'each', min_qty: 1, turnaround_days: 3, stock: null,
    description: 'Cut from 5-year outdoor calendared vinyl, weeded and taped with an application layer. Priced up to 12" on the long side.',
    image_url: '/brand/products/vinyl-decal.jpg',
    options: { sizes: ['Up to 6"','Up to 12"','Up to 24" (+$8.00)'], substrates: ['Gloss vinyl','Matte vinyl','Reflective (+$4.00)'], colors: ['White','Black','Red','Cyan','Magenta','Yellow','Gold metallic'] } },
  { sku: 'VIN-DOOR', name: 'Vehicle Door Lettering', category: 'Vinyl & Decals', base_price: 95.0, unit: 'per pair', min_qty: 1, turnaround_days: 4, stock: null,
    description: 'DOT-compliant business name, town and phone for both truck doors. Includes layout proof and on-site installation in Williston.',
    image_url: '/brand/products/door-lettering.jpg',
    options: { lines: ['2 lines','3 lines','4 lines (+$20.00)'], colors: ['White','Black','Red','Gold metallic'], install: ['Ship flat','Install at shop (+$40.00)'] } },
  { sku: 'BAN-13OZ', name: '13oz Vinyl Banner', category: 'Signage & Banners', base_price: 4.25, unit: 'sq ft', min_qty: 12, turnaround_days: 3, stock: null,
    description: 'Full-color solvent print on 13oz scrim vinyl. Hemmed edges and grommets every two feet come standard.',
    image_url: '/brand/products/vinyl-banner.jpg',
    options: { sizes: ['2x4 ft','3x6 ft','3x8 ft','4x8 ft','Custom'], finishing: ['Hem + grommets','Pole pockets (+$15.00)','No finishing'], sides: ['Single-sided','Double-sided (+65%)'] } },
  { sku: 'SGN-YARD', name: 'Coroplast Yard Sign 18x24', category: 'Signage & Banners', base_price: 12.0, unit: 'each', min_qty: 10, turnaround_days: 4, stock: 400,
    description: '4mm corrugated plastic sign, full color. H-stakes included. Election season, real estate and ballfield sponsors all live here.',
    image_url: '/brand/products/yard-signs.jpg',
    options: { sides: ['Single-sided','Double-sided (+$4.00)'], stakes: ['Include H-stakes','No stakes'], quantities: ['10','25','50','100'] } },
  { sku: 'BLU-2436', name: 'Blueprint / Plan Print 24x36', category: 'Blueprints', base_price: 6.5, unit: 'each', min_qty: 1, turnaround_days: 1, stock: null,
    description: 'Large-format bond plotting for construction sets and site plans. Same-day if the file lands before 2pm.',
    image_url: '/brand/products/blueprints.jpg',
    options: { sizes: ['18x24','24x36','30x42','36x48 (+$3.00)'], stock: ['20lb bond','Vellum (+$4.00)','Mylar (+$9.00)'], binding: ['Loose','Rolled','Bound sets (+$6.00)'] } },
  { sku: 'BUS-TICKET', name: 'Carbonless Ticket Book — 50 Set', category: 'Business Print', base_price: 32.0, unit: 'each', min_qty: 10, turnaround_days: 6, stock: null,
    description: 'Numbered 2- or 3-part carbonless work-order books, wrap cover and chipboard back. Built for service trucks and gravel haulers.',
    image_url: '/brand/products/ticket-books.jpg',
    options: { parts: ['2-part white/canary','3-part white/canary/pink (+$8.00)'], numbering: ['Sequential numbering','No numbering'], binding: ['Top glued + wrap','Side glued'] } },
  { sku: 'BUS-CARD', name: 'Business Cards — 16pt (500 ct)', category: 'Business Print', base_price: 65.0, unit: 'each', min_qty: 1, turnaround_days: 5, stock: null,
    description: '16pt uncoated or gloss stock, full color both sides. Free layout tweak from your existing logo file.',
    image_url: '/brand/products/business-cards.jpg',
    options: { quantities: ['500','1000 (+$40.00)','2500 (+$120.00)'], finishes: ['Matte','Gloss UV','Soft-touch (+$35.00)'], sides: ['Front only','Front + back'] } },
  { sku: 'BUS-FLYER', name: 'Full-Color Flyers 8.5x11 (500 ct)', category: 'Business Print', base_price: 95.0, unit: 'each', min_qty: 1, turnaround_days: 4, stock: null,
    description: '100lb gloss text, full bleed. Perfect for co-op field-day handouts, band nights and grand openings.',
    image_url: '/brand/products/flyers.jpg',
    options: { quantities: ['500','1000 (+$55.00)','2500 (+$180.00)'], sides: ['Single-sided','Double-sided (+$25.00)'], folds: ['Flat','Half fold (+$18.00)','Tri-fold (+$22.00)'] } },
  { sku: 'PRO-TUMB', name: 'Laser-Engraved 20oz Tumbler', category: 'Promo', base_price: 21.0, unit: 'each', min_qty: 6, turnaround_days: 5, stock: 180,
    description: 'Powder-coated stainless tumbler with a permanent laser-etched mark. Popular for retirement gifts and crew swag.',
    image_url: '/brand/products/tumbler.jpg',
    options: { colors: ['Matte Black','White','Olive','Maroon','Stainless'], engrave: ['One side','Two sides (+$5.00)'], lids: ['Slider lid','Flip straw lid (+$2.00)'] } },
];

const CUSTOMERS = [
  { company: 'Bakken Ridge Chevrolet', contact_name: 'Dale Hoffmann', email: 'dale@buffaloridgechev.com', phone: '701-572-1140', address: '2240 6th Ave SE', city: 'Williston', state: 'ND', zip: '58801', source: 'rep', notes: 'Wants door lettering on every new service truck. Net-30, PO required.' },
  { company: 'Prairie Gold Co-op', contact_name: 'Marla Vandenberg', email: 'marla@prairiegoldcoop.com', phone: '(605) 297-3182', address: '105 Railroad Ave', city: 'Groton', state: 'SD', zip: '57445', source: 'rep', notes: 'Annual agronomy field day — banners + flyers every June.' },
  { company: 'Redfield High School Athletics', contact_name: 'Coach Tim Ostrem', email: 'tostrem@redfieldpheasants.k12.sd.us', phone: '(605) 472-1188', address: '1215 Main St W', city: 'Redfield', state: 'SD', zip: '57469', source: 'website', notes: 'Pheasant pride tees for every season. Tax exempt on file.' },
  { company: 'The Rusty Spur Bar & Grill', contact_name: 'Jenna Kraus', email: 'jenna@rustyspurbar.com', phone: '(605) 448-2216', address: '18 E Main St', city: 'Watertown', state: 'SD', zip: '57201', source: 'walk-in', notes: 'Tap-takeover tees and yard signs, always rush.' },
  { company: 'Hoven Concrete & Excavating', contact_name: 'Rick Sauer', email: 'rick@hovenconcrete.net', phone: '(605) 948-3390', address: '3110 Hwy 12', city: 'Hoven', state: 'SD', zip: '57450', source: 'rep', notes: 'Ticket books quarterly. Wants numbering to continue from last run.' },
  { company: 'Spink County Fair Board', contact_name: 'Deb Larsen', email: 'deb@spinkcountyfair.org', phone: '(605) 472-0774', address: '400 Fairgrounds Rd', city: 'Redfield', state: 'SD', zip: '57469', source: 'website', notes: 'Sponsor banners due before July 4 parade.' },
  { company: 'Sioux Valley Builders', contact_name: 'Andrew Petsche', email: 'apetsche@siouxvalleybuilders.com', phone: '(712) 335-4102', address: '812 Industrial Park Rd', city: 'Spencer', state: 'IA', zip: '51301', source: 'website', notes: 'Plan sets weekly — 24x36 bond, rolled.' },
  { company: 'Glacial Lakes Plumbing', contact_name: 'Curt Odland', email: 'curt@glaciallakesplumbing.com', phone: '(605) 882-6641', address: '2405 9th Ave SE', city: 'Watertown', state: 'SD', zip: '57201', source: 'rep', notes: 'Van lettering + embroidered polos for six techs.' },
  { company: 'Williston State Rodeo Club', contact_name: 'Shelby Nack', email: 'shelby.nack@northern.edu', phone: '701-774-4200', address: '1200 S Jay St', city: 'Williston', state: 'ND', zip: '58801', source: 'website', notes: 'Student org — needs quote sheets for advisor approval.' },
  { company: 'Dakota Feed & Seed', contact_name: 'Wendell Trapp', email: 'wendell@dakotafeedseed.com', phone: '(605) 765-9143', address: '77 Commercial St', city: 'Gettysburg', state: 'SD', zip: '57442', source: 'walk-in', notes: 'Caps and tumblers for customer appreciation day.' },
  { company: 'Kranzler Family Dental', contact_name: 'Dr. Amy Kranzler', email: 'office@kranzlerdental.com', phone: '701-572-7700', address: '1720 8th Ave NE', city: 'Williston', state: 'ND', zip: '58801', source: 'website', notes: 'Business cards + recall postcards. Wants soft-touch finish.' },
  { company: 'Milbank Bulldogs Baseball', contact_name: 'Josh Feiner', email: 'jfeiner@milbankbaseball.org', phone: '(605) 432-5591', address: '900 E 4th Ave', city: 'Milbank', state: 'SD', zip: '57252', source: 'website', notes: 'Sponsor fence banners + player hoodies each spring.' },
];

const STATUS_FLOW = ['new','proof','approved','print','finishing','ready','shipped','completed'];

const ORDER_PLAN = [
  { c: 3, status: 'new', src: 'website', days: 0, pay: 'unpaid', rush: 1, items: [['SP-TEE-1C', 96], ['SP-HOOD', 24]] },
  { c: 6, status: 'new', src: 'website', days: 1, pay: 'deposit', rush: 0, items: [['BAN-13OZ', 3], ['SGN-YARD', 25]] },
  { c: 9, status: 'proof', src: 'website', days: 2, pay: 'unpaid', rush: 0, items: [['DTF-TEE', 36]] },
  { c: 1, status: 'proof', src: 'rep', days: 3, pay: 'deposit', rush: 0, items: [['VIN-DOOR', 4], ['EMB-CAP', 24]] },
  { c: 4, status: 'approved', src: 'phone', days: 3, pay: 'paid', rush: 1, items: [['SP-TEE-3C', 48]] },
  { c: 12, status: 'approved', src: 'website', days: 4, pay: 'deposit', rush: 0, items: [['BAN-13OZ', 6], ['SP-HOOD', 30]] },
  { c: 5, status: 'print', src: 'rep', days: 5, pay: 'deposit', rush: 0, items: [['BUS-TICKET', 25]] },
  { c: 2, status: 'print', src: 'rep', days: 6, pay: 'unpaid', rush: 0, items: [['BAN-13OZ', 4], ['BUS-FLYER', 2]] },
  { c: 10, status: 'finishing', src: 'walk-in', days: 7, pay: 'paid', rush: 0, items: [['EMB-CAP', 36], ['PRO-TUMB', 24]] },
  { c: 8, status: 'finishing', src: 'rep', days: 8, pay: 'deposit', rush: 0, items: [['EMB-POLO', 18], ['VIN-DOOR', 6]] },
  { c: 7, status: 'ready', src: 'website', days: 9, pay: 'paid', rush: 0, items: [['BLU-2436', 40]] },
  { c: 11, status: 'ready', src: 'website', days: 10, pay: 'paid', rush: 0, items: [['BUS-CARD', 2]] },
  { c: 3, status: 'shipped', src: 'website', days: 13, pay: 'paid', rush: 0, items: [['SP-TEE-1C', 144]] },
  { c: 6, status: 'shipped', src: 'rep', days: 15, pay: 'paid', rush: 1, items: [['SGN-YARD', 50]] },
  { c: 4, status: 'completed', src: 'walk-in', days: 19, pay: 'paid', rush: 0, items: [['SP-TEE-3C', 72], ['VIN-DECAL', 40]] },
  { c: 5, status: 'completed', src: 'rep', days: 24, pay: 'paid', rush: 0, items: [['BUS-TICKET', 40]] },
  { c: 7, status: 'completed', src: 'website', days: 28, pay: 'paid', rush: 0, items: [['BLU-2436', 65]] },
  { c: 1, status: 'completed', src: 'rep', days: 33, pay: 'paid', rush: 0, items: [['EMB-POLO', 24], ['VIN-DECAL', 30]] },
  { c: 12, status: 'completed', src: 'website', days: 41, pay: 'paid', rush: 0, items: [['BAN-13OZ', 8], ['SP-TEE-1C', 60]] },
  { c: 9, status: 'completed', src: 'website', days: 47, pay: 'paid', rush: 1, items: [['DTF-TEE', 24], ['PRO-TUMB', 12]] },
  { c: 2, status: 'completed', src: 'rep', days: 55, pay: 'paid', rush: 0, items: [['BUS-FLYER', 3], ['BAN-13OZ', 5]] },
  { c: 10, status: 'cancelled', src: 'website', days: 12, pay: 'unpaid', rush: 0, items: [['PRO-TUMB', 24]] },
  { c: 11, status: 'completed', src: 'website', days: 62, pay: 'paid', rush: 0, items: [['BUS-CARD', 1], ['BUS-FLYER', 1]] },
];

const SPECS = {
  Apparel: () => ({ sizes: { S: 6, M: 18, L: 24, XL: 18, '2XL': 8 }, ink_colors: 'White + Cardinal Red', placement: 'Front, 11" wide' }),
  'Signage & Banners': () => ({ dimensions: '3 ft x 8 ft', finishing: 'Hem + grommets', sides: 'Single-sided' }),
  'Vinyl & Decals': () => ({ dimensions: 'Up to 12"', substrate: 'Gloss vinyl', color: 'White' }),
  'Business Print': () => ({ stock: '16pt uncoated', sides: 'Front + back', numbering: 'Sequential' }),
  Blueprints: () => ({ size: '24x36', stock: '20lb bond', binding: 'Rolled' }),
  Promo: () => ({ color: 'Matte Black', engrave: 'One side', lids: 'Slider lid' }),
};

const TASK_CHAIN = [
  { type: 'payment', title: 'Confirm payment / collect deposit', offset: 1 },
  { type: 'proof', title: 'Build proof and send for approval', offset: 2 },
  { type: 'print', title: 'Print / production run', offset: 4 },
  { type: 'finishing', title: 'Finishing, fold and count', offset: 5 },
  { type: 'ship', title: 'Ready for pickup / ship with tracking', offset: 6 },
];

export function seedTasksForOrder(orderId, dueDate, assignee = 'Evie Lundberg') {
  const base = dueDate ? new Date(dueDate) : daysAhead(7);
  const stmt = db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to) VALUES (?,?,?,?,?,?)');
  TASK_CHAIN.forEach((t, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() - (TASK_CHAIN.length - i));
    stmt.run(orderId, t.title, t.type, 'open', dateOnly(d), assignee);
  });
}

function seedUsers() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@dakotaprints.com').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'ForgedOS2026!';
  const hash = bcrypt.hashSync(adminPass, 10);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (existing) db.prepare('UPDATE users SET password_hash=?, role=? WHERE id=?').run(hash, 'admin', existing.id);
  else db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run('Frank Ortega', adminEmail, hash, 'admin');

  const rep = db.prepare('SELECT id FROM users WHERE email = ?').get('evie@dakotaprints.com');
  if (!rep) db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run('Evie Lundberg', 'evie@dakotaprints.com', bcrypt.hashSync('ForgedOS2026!', 10), 'rep');
}

export function seed() {
  seedUsers();

  const defaults = {
    shop_name: 'Dakota Prints',
    shop_tagline: 'Screen print, embroidery, signs & business print — Williston, North Dakota',
    shop_phone: '701-713-4400',
    shop_email: 'orders@dakotaprints.com',
    shop_address: '201 2nd Ave W, Williston, ND 58801',
    tax_rate: '4.5',
    rush_fee_pct: '20',
    default_turnaround: '7',
    notify_email: 'orders@dakotaprints.com',
    low_stock_threshold: '48',
    webhook_token: process.env.OS_WEBHOOK_TOKEN || 'dakota-website-2026',
    website_url: process.env.WEBSITE_URL || 'https://www.dakotaprints.com',
    tpl_order_received: 'Thanks {{contact_name}} — we received order {{order_number}}. Total {{total}}. We will have a proof to you within one business day.',
    tpl_proof_ready: 'Hi {{contact_name}}, your proof for {{order_number}} is ready. Reply APPROVE and we will put it on the press.',
    tpl_deposit_reminder: '{{contact_name}}, a 50% deposit of {{deposit}} is due on {{order_number}} before we schedule production.',
    tpl_ready_pickup: 'Good news {{contact_name}} — {{order_number}} is boxed and ready at 201 2nd Ave W, Williston. Open 8–5 weekdays.',
    tpl_shipped: '{{order_number}} shipped today. Tracking: {{tracking_number}}.',
    tpl_reorder_followup: 'Hi {{contact_name}} — running low on {{last_product}}? Reorders keep your screens and digitizing on file, no setup fee.',
  };
  for (const [k, v] of Object.entries(defaults)) if (getSetting(k) === null) setSetting(k, v);

  if (db.prepare('SELECT COUNT(*) n FROM products').get().n === 0) {
    const stmt = db.prepare(`INSERT INTO products (sku,name,category,description,base_price,unit,min_qty,turnaround_days,image_url,stock,active,options_json)
      VALUES (@sku,@name,@category,@description,@base_price,@unit,@min_qty,@turnaround_days,@image_url,@stock,1,@options_json)`);
    for (const p of PRODUCTS) stmt.run({ ...p, stock: p.stock ?? null, options_json: JSON.stringify(p.options || {}) });
  }

  if (db.prepare('SELECT COUNT(*) n FROM customers').get().n === 0) {
    const stmt = db.prepare(`INSERT INTO customers (company,contact_name,email,phone,address,city,state,zip,notes,source,created_at)
      VALUES (@company,@contact_name,@email,@phone,@address,@city,@state,@zip,@notes,@source,@created_at)`);
    CUSTOMERS.forEach((c, i) => stmt.run({ ...c, created_at: iso(daysAgo(120 - i * 7)) }));
  }

  if (db.prepare('SELECT COUNT(*) n FROM orders WHERE 1').get().n === 0) {
    const products = db.prepare('SELECT * FROM products').all();
    const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));
    const taxRate = Number(getSetting('tax_rate')) / 100;
    const rushPct = Number(getSetting('rush_fee_pct')) / 100;

    const insOrder = db.prepare(`INSERT INTO orders (order_number,customer_id,source,status,payment_status,payment_method,fulfillment,subtotal,rush_fee,shipping,tax,total,due_date,rush,artwork_url,notes,po_number,tracking_number,created_at,updated_at)
      VALUES (@order_number,@customer_id,@source,@status,@payment_status,@payment_method,@fulfillment,@subtotal,@rush_fee,@shipping,@tax,@total,@due_date,@rush,@artwork_url,@notes,@po_number,@tracking_number,@created_at,@updated_at)`);
    const insItem = db.prepare('INSERT INTO order_items (order_id,product_id,name,description,qty,unit_price,line_total,spec_json) VALUES (?,?,?,?,?,?,?,?)');
    const insEvent = db.prepare('INSERT INTO order_events (order_id,type,message,actor,created_at) VALUES (?,?,?,?,?)');
    const insTask = db.prepare('INSERT INTO tasks (order_id,title,type,status,due_date,assigned_to,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?)');
    const insMsg = db.prepare('INSERT INTO messages (customer_id,order_id,channel,direction,subject,body,template,created_at) VALUES (?,?,?,?,?,?,?,?)');
    const insNote = db.prepare('INSERT INTO notifications (type,title,body,order_id,read,created_at) VALUES (?,?,?,?,?,?)');

    ORDER_PLAN.forEach((plan, idx) => {
      const created = daysAgo(plan.days);
      const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(plan.c);
      let subtotal = 0;
      const lines = plan.items.map(([sku, qty]) => {
        const p = bySku[sku];
        const unit = p.base_price;
        const line = Math.round(unit * qty * 100) / 100;
        subtotal += line;
        return { p, qty, unit, line };
      });
      const rush_fee = plan.rush ? Math.round(subtotal * rushPct * 100) / 100 : 0;
      const shipping = plan.src === 'walk-in' ? 0 : subtotal > 500 ? 0 : 24.5;
      const tax = Math.round((subtotal + rush_fee) * taxRate * 100) / 100;
      const total = Math.round((subtotal + rush_fee + shipping + tax) * 100) / 100;
      const due = daysAhead(plan.status === 'completed' || plan.status === 'shipped' ? -Math.round(plan.days / 3) : 7 - Math.min(plan.days, 6));

      const res = insOrder.run({
        order_number: `DP-${dateOnly(created).replace(/-/g, '')}-${String(1000 + idx * 37 + (idx % 7) * 11)}`,
        customer_id: plan.c, source: plan.src, status: plan.status,
        payment_status: plan.pay, payment_method: plan.pay === 'paid' ? 'Card (demo)' : plan.pay === 'deposit' ? '50% deposit' : 'Pay on invoice',
        fulfillment: plan.src === 'walk-in' ? 'pickup' : 'ship',
        subtotal, rush_fee, shipping, tax, total,
        due_date: dateOnly(due), rush: plan.rush,
        artwork_url: idx % 3 === 0 ? '/brand/products/artwork-proof.jpg' : null,
        notes: idx % 4 === 0 ? 'Match last run — screens and digitizing on file.' : null,
        po_number: cust.source === 'rep' ? `PO-${4400 + idx}` : null,
        tracking_number: ['shipped'].includes(plan.status) ? `1Z999AA10${123456 + idx}` : null,
        created_at: iso(created), updated_at: iso(daysAgo(Math.max(0, plan.days - 2))),
      });
      const oid = res.lastInsertRowid;
      for (const l of lines) {
        insItem.run(oid, l.p.id, l.p.name, l.p.description?.slice(0, 90), l.qty, l.unit, l.line, JSON.stringify((SPECS[l.p.category] || SPECS.Promo)()));
      }
      // timeline: walk the flow up to current status
      const stopAt = plan.status === 'cancelled' ? 2 : STATUS_FLOW.indexOf(plan.status);
      const labels = {
        new: 'Order received from ' + (plan.src === 'website' ? 'dakotaprints.com checkout' : plan.src === 'rep' ? 'rep (Evie Lundberg)' : 'phone/walk-in'),
        proof: 'Proof built and emailed to customer',
        approved: 'Customer approved the proof',
        print: 'Moved to press — production started',
        finishing: 'Finishing: trim, fold and count',
        ready: 'Job complete, staged for pickup/shipping',
        shipped: 'Shipped / picked up',
        completed: 'Order closed out and invoiced',
      };
      for (let s = 0; s <= stopAt; s++) {
        const st = STATUS_FLOW[s];
        const when = new Date(created); when.setHours(when.getHours() + s * 9);
        insEvent.run(oid, s === 0 ? 'created' : 'status', labels[st], s === 0 ? (plan.src === 'website' ? 'Website' : 'Evie Lundberg') : 'Evie Lundberg', iso(when));
      }
      if (plan.status === 'cancelled') insEvent.run(oid, 'status', 'Order cancelled — customer postponed to next season', 'Frank Ortega', iso(daysAgo(plan.days - 1)));

      // tasks: completed for stages already passed
      TASK_CHAIN.forEach((t, i) => {
        const done = i <= stopAt - 1 || plan.status === 'completed' || plan.status === 'cancelled';
        const d = new Date(due); d.setDate(d.getDate() - (TASK_CHAIN.length - i));
        insTask.run(oid, t.title, t.type, done ? 'done' : 'open', dateOnly(d), idx % 3 === 0 ? 'Frank Ortega' : 'Evie Lundberg', iso(created), done ? iso(daysAgo(Math.max(0, plan.days - i))) : null);
      });

      insMsg.run(plan.c, oid, 'email', 'out', `Dakota Prints — order ${plan.status === 'new' ? 'received' : 'update'}`,
        `Thanks ${cust.contact_name} — we received your order. Total $${total.toFixed(2)}.`, 'order_received', iso(created));
      if (stopAt >= 1) insMsg.run(plan.c, oid, 'email', 'out', 'Your proof is ready', `Hi ${cust.contact_name}, your proof is ready for approval.`, 'proof_ready', iso(daysAgo(Math.max(0, plan.days - 1))));
      if (plan.status === 'ready') insMsg.run(plan.c, oid, 'sms', 'out', null, `${cust.contact_name}, your order is boxed and ready at 412 S Main St.`, 'ready_pickup', iso(daysAgo(1)));
      if (plan.status === 'shipped') insMsg.run(plan.c, oid, 'email', 'out', 'Shipped', `Tracking: 1Z999AA10${123456 + idx}`, 'shipped', iso(daysAgo(1)));

      if (plan.days <= 4) insNote.run(plan.src === 'website' ? 'website_order' : 'order',
        `${plan.src === 'website' ? 'New website order' : 'New order'} — ${cust.company}`,
        `${plan.items.length} line item${plan.items.length > 1 ? 's' : ''} · $${total.toFixed(2)}${plan.rush ? ' · RUSH' : ''}`,
        oid, plan.days > 1 ? 1 : 0, iso(created));
    });

    // low-stock alert notification + restock task
    const low = db.prepare('SELECT * FROM products WHERE stock IS NOT NULL AND stock < 200 ORDER BY stock LIMIT 1').get();
    if (low) {
      insNote.run('low_stock', `Blank stock low — ${low.name}`, `${low.stock} on hand, below the reorder point.`, null, 0, iso(daysAgo(1)));
      insTask.run(null, `Restock blanks: ${low.name}`, 'followup', 'open', dateOnly(daysAhead(2)), 'Frank Ortega', iso(daysAgo(1)), null);
    }
    db.prepare(`UPDATE customers SET total_spend = COALESCE((SELECT SUM(total) FROM orders o WHERE o.customer_id = customers.id AND o.status != 'cancelled'),0)`).run();
  }

  // A little inbound-webhook history so the Settings integration log is populated on first login.
  if (db.prepare('SELECT COUNT(*) n FROM webhook_log').get().n === 0) {
    const ins = db.prepare('INSERT INTO webhook_log (endpoint,status,order_number,ip,payload_preview,created_at) VALUES (?,?,?,?,?,?)');
    const recent = db.prepare("SELECT order_number, created_at FROM orders WHERE source='website' ORDER BY datetime(created_at) DESC LIMIT 5").all();
    recent.forEach((o, i) => {
      ins.run('POST /api/public/orders', 201, o.order_number, '162.158.78.4',
        `{"customer":{"contact_name":"…","email":"…"},"items":[…],"rush":${i % 3 === 0}}`, o.created_at);
      ins.run('GET /api/public/products', 200, null, '162.158.78.4', 'category=All', iso(daysAgo(i)));
    });
    ins.run('POST /api/public/orders', 401, null, '45.83.220.11', 'invalid x-webhook-token', iso(daysAgo(3)));
  }
}
