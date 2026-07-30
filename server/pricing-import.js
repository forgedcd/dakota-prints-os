// CSV pricing importer — column auto-detect, New/Changed/Unchanged/Errors
// diff preview, and atomic commit. Supports the three importable modes:
// matrix, flat_option, sqft. Nothing is written to the DB unless commit=true.
import { db } from './db.js';
import { axesFor, cellKeyFrom, materialsFor, optionsFor } from './pricing.js';
import { money } from './catalog.js';

// --------------------------------------------------------------- CSV parsing
/** Minimal RFC4180 CSV parser (handles quoted fields with embedded commas/quotes). */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // drop trailing blank rows
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop();
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { header, records };
}

// ---------------------------------------------------------- column detection
const COLUMN_SYNONYMS = {
  size: ['size', 'finished size', 'dimensions'],
  parts: ['parts', 'part'],
  qty_label: ['qty_label', 'quantity', 'qty', 'quantity label'],
  books: ['books', 'book'],
  forms: ['forms', 'form'],
  price: ['price', 'amount', 'total', 'rate'],
  label: ['label', 'name', 'option'],
  sku_suffix: ['sku_suffix', 'sku'],
  sort_order: ['sort_order', 'order', 'sort'],
  rate_per_sqft: ['rate_per_sqft', 'rate', 'price_per_sqft', 'sqft_rate'],
  allows_double_sided: ['allows_double_sided', 'double_sided', 'double sided'],
};

function detectColumn(header, canonical) {
  const names = COLUMN_SYNONYMS[canonical] || [canonical];
  const lower = header.map((h) => h.toLowerCase());
  for (const n of names) {
    const idx = lower.indexOf(n);
    if (idx !== -1) return header[idx];
  }
  return null;
}

// ------------------------------------------------------------------- matrix
function importMatrix(product, records, header, commit, meta) {
  const axes = axesFor(product.id);
  if (axes.length < 2) throw new Error('This product has no matrix axes configured yet — set up axes in the editor before importing rows.');

  // Map the 3 known axis roles by name convention: size / parts / qty(+books/forms).
  // Falls back to positional axis order if names don't match "size"/"parts"/"qty".
  const colSize = detectColumn(header, 'size');
  const colParts = detectColumn(header, 'parts');
  const colQty = detectColumn(header, 'qty_label');
  const colBooks = detectColumn(header, 'books');
  const colForms = detectColumn(header, 'forms');
  const colPrice = detectColumn(header, 'price');
  if (!colPrice) throw new Error('Could not find a price column (expected one of: price, amount, total, rate).');

  const roleCols = [colSize, colParts, colQty].filter(Boolean);
  if (roleCols.length !== axes.length) {
    throw new Error(`Expected ${axes.length} axis columns (size, parts, qty_label) but found ${roleCols.length} in the CSV header: ${header.join(', ')}`);
  }

  // Build value -> id lookup per axis (case-insensitive exact match on the
  // axis value label as stored, e.g. '8.5" x 11"', '2 Parts', '10 books').
  const axisLookup = axes.map((a) => new Map(a.values.map((v) => [v.value.toLowerCase(), v])));
  const existingCells = new Map(db.prepare('SELECT cell_key, price FROM product_matrix_cells WHERE product_id=?').all(product.id).map((c) => [c.cell_key, c.price]));

  const diff = { new: [], changed: [], unchanged: [], errors: [] };
  const toCommit = [];
  const cols = [colSize, colParts, colQty];

  records.forEach((r, i) => {
    const rowNum = i + 2; // +1 header, +1 to make it 1-based
    const price = Number(r[colPrice]);
    if (!r[colPrice] || Number.isNaN(price)) { diff.errors.push({ row: rowNum, reason: `Invalid price "${r[colPrice]}"`, record: r }); return; }

    const ids = [];
    let bad = null;
    for (let ai = 0; ai < axes.length; ai++) {
      const col = cols[ai];
      if (!col) { bad = `Missing column for axis "${axes[ai].name}"`; break; }
      const raw = (r[col] || '').trim().toLowerCase();
      const val = axisLookup[ai].get(raw);
      if (!val) { bad = `Unknown value "${r[col]}" for axis "${axes[ai].name}"`; break; }
      ids.push(val.id);
    }
    if (bad) { diff.errors.push({ row: rowNum, reason: bad, record: r }); return; }

    const key = cellKeyFrom(ids);
    const label = cols.map((c) => r[c]).join(' / ');
    const existing = existingCells.get(key);
    const newPrice = money(price);
    if (existing === undefined) {
      diff.new.push({ row: rowNum, label, price: newPrice });
      toCommit.push({ key, price: newPrice });
    } else if (Math.abs(existing - newPrice) >= 0.005) {
      diff.changed.push({ row: rowNum, label, old_price: money(existing), new_price: newPrice });
      toCommit.push({ key, price: newPrice });
    } else {
      diff.unchanged.push({ row: rowNum, label, price: newPrice });
    }
  });

  if (commit) {
    const ins = db.prepare('INSERT INTO product_matrix_cells (product_id,cell_key,price) VALUES (?,?,?) ON CONFLICT(product_id,cell_key) DO UPDATE SET price=excluded.price');
    db.transaction(() => { for (const c of toCommit) ins.run(product.id, c.key, c.price); })();
    logImport(product, meta, 'matrix', diff);
  }
  return { mode: 'matrix', row_count: records.length, diff };
}

// -------------------------------------------------------------- flat_option
function importFlatOption(product, records, header, commit, meta) {
  const colLabel = detectColumn(header, 'label');
  const colPrice = detectColumn(header, 'price');
  const colSku = detectColumn(header, 'sku_suffix');
  const colSort = detectColumn(header, 'sort_order');
  if (!colLabel || !colPrice) throw new Error('Could not find label/price columns (expected: label, price).');

  const existing = new Map(optionsFor(product.id).map((o) => [o.label.toLowerCase(), o]));
  const diff = { new: [], changed: [], unchanged: [], errors: [] };
  const rows = [];

  records.forEach((r, i) => {
    const rowNum = i + 2;
    const label = (r[colLabel] || '').trim();
    const price = Number(r[colPrice]);
    if (!label) { diff.errors.push({ row: rowNum, reason: 'Missing label', record: r }); return; }
    if (!r[colPrice] || Number.isNaN(price)) { diff.errors.push({ row: rowNum, reason: `Invalid price "${r[colPrice]}"`, record: r }); return; }
    const newPrice = money(price);
    const sku = colSku ? (r[colSku] || null) : null;
    const sort = colSort && r[colSort] !== '' ? Number(r[colSort]) : i;
    const ex = existing.get(label.toLowerCase());
    if (!ex) diff.new.push({ row: rowNum, label, price: newPrice });
    else if (Math.abs(ex.price - newPrice) >= 0.005) diff.changed.push({ row: rowNum, label, old_price: money(ex.price), new_price: newPrice });
    else diff.unchanged.push({ row: rowNum, label, price: newPrice });
    rows.push({ label, price: newPrice, sku_suffix: sku, sort_order: sort });
  });

  if (commit) {
    const ins = db.prepare('INSERT INTO product_options (product_id,label,price,sku_suffix,sort_order,active) VALUES (?,?,?,?,?,1)');
    db.transaction(() => {
      db.prepare('DELETE FROM product_options WHERE product_id=?').run(product.id);
      rows.forEach((o) => ins.run(product.id, o.label, o.price, o.sku_suffix, o.sort_order));
    })();
    logImport(product, meta, 'flat_option', diff);
  }
  return { mode: 'flat_option', row_count: records.length, diff };
}

// ---------------------------------------------------------------------- sqft
function importSqft(product, records, header, commit, meta) {
  const colLabel = detectColumn(header, 'label');
  const colRate = detectColumn(header, 'rate_per_sqft');
  const colDouble = detectColumn(header, 'allows_double_sided');
  const colSort = detectColumn(header, 'sort_order');
  if (!colLabel || !colRate) throw new Error('Could not find label/rate columns (expected: label, rate_per_sqft).');

  const existing = new Map(materialsFor(product.id).map((m) => [m.label.toLowerCase(), m]));
  const diff = { new: [], changed: [], unchanged: [], errors: [] };
  const rows = [];

  records.forEach((r, i) => {
    const rowNum = i + 2;
    const label = (r[colLabel] || '').trim();
    const rate = Number(r[colRate]);
    if (!label) { diff.errors.push({ row: rowNum, reason: 'Missing label', record: r }); return; }
    if (!r[colRate] || Number.isNaN(rate)) { diff.errors.push({ row: rowNum, reason: `Invalid rate "${r[colRate]}"`, record: r }); return; }
    const allowsDouble = colDouble ? /^(1|true|yes|y)$/i.test((r[colDouble] || '').trim()) : true;
    const sort = colSort && r[colSort] !== '' ? Number(r[colSort]) : i;
    const newRate = money(rate);
    const ex = existing.get(label.toLowerCase());
    if (!ex) diff.new.push({ row: rowNum, label, rate_per_sqft: newRate });
    else if (Math.abs(ex.rate_per_sqft - newRate) >= 0.005 || !!ex.allows_double_sided !== allowsDouble) {
      diff.changed.push({ row: rowNum, label, old_rate: money(ex.rate_per_sqft), new_rate: newRate, old_double_sided: !!ex.allows_double_sided, new_double_sided: allowsDouble });
    } else diff.unchanged.push({ row: rowNum, label, rate_per_sqft: newRate });
    rows.push({ label, rate_per_sqft: newRate, allows_double_sided: allowsDouble ? 1 : 0, sort_order: sort });
  });

  if (commit) {
    const ins = db.prepare('INSERT INTO product_materials (product_id,label,rate_per_sqft,allows_double_sided,sort_order,active) VALUES (?,?,?,?,?,1)');
    db.transaction(() => {
      db.prepare('DELETE FROM product_materials WHERE product_id=?').run(product.id);
      rows.forEach((m) => ins.run(product.id, m.label, m.rate_per_sqft, m.allows_double_sided, m.sort_order));
    })();
    logImport(product, meta, 'sqft', diff);
  }
  return { mode: 'sqft', row_count: records.length, diff };
}

function logImport(product, meta, mode, diff) {
  db.prepare(`INSERT INTO pricing_imports (product_id,product_name,filename,mode,actor,rows_added,rows_changed,rows_unchanged,rows_error)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    product.id, product.name, meta?.filename || 'upload.csv', mode, meta?.actor || 'OS admin',
    diff.new.length, diff.changed.length, diff.unchanged.length, diff.errors.length,
  );
}

/** Entry point used by both preview (commit=false) and commit (commit=true) routes. */
export function runImport({ product, csvText, commit = false, actor = null, filename = null }) {
  const { header, records } = parseCsv(csvText);
  if (!header.length) throw new Error('Could not read a header row from that CSV.');
  if (!records.length) throw new Error('That CSV has no data rows.');

  const mode = product.pricing_mode;
  const meta = { actor, filename };
  let result;
  if (mode === 'matrix') result = importMatrix(product, records, header, commit, meta);
  else if (mode === 'flat_option') result = importFlatOption(product, records, header, commit, meta);
  else if (mode === 'sqft') result = importSqft(product, records, header, commit, meta);
  else throw new Error(`Pricing mode "${mode}" is not importable via CSV (only matrix, flat_option and sqft are).`);

  return { ...result, csv_text: commit ? undefined : csvText, committed: commit };
}

// --------------------------------------------------------- template + export
function toCsv(header, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\n') + '\n';
}

export function buildTemplateCsv(product) {
  const mode = product.pricing_mode;
  if (mode === 'matrix') {
    const axes = axesFor(product.id);
    if (axes.length < 2) throw new Error('Configure this product\'s axes before downloading a template.');
    const header = [...axes.map((a) => a.name.toLowerCase().replace(/\s+/g, '_')), 'price'];
    // one example row per first-axis value using the first value of every other axis, for a starting point
    const example = Object.fromEntries(axes.map((a) => [a.name.toLowerCase().replace(/\s+/g, '_'), a.values[0]?.value || '']));
    example.price = '0.00';
    return toCsv(header, [example]);
  }
  if (mode === 'flat_option') return toCsv(['label', 'price', 'sku_suffix', 'sort_order'], [{ label: 'Example option', price: '0.00', sku_suffix: '', sort_order: 0 }]);
  if (mode === 'sqft') return toCsv(['label', 'rate_per_sqft', 'allows_double_sided', 'sort_order'], [{ label: 'Example material', rate_per_sqft: '0.00', allows_double_sided: 'true', sort_order: 0 }]);
  throw new Error(`Pricing mode "${mode}" has no CSV template (only matrix, flat_option and sqft are importable).`);
}

export function exportPricingCsv(product) {
  const mode = product.pricing_mode;
  if (mode === 'matrix') {
    const axes = axesFor(product.id);
    const header = [...axes.map((a) => a.name.toLowerCase().replace(/\s+/g, '_')), 'price'];
    const cells = db.prepare('SELECT cell_key, price FROM product_matrix_cells WHERE product_id=?').all(product.id);
    const idToValue = new Map();
    axes.forEach((a) => a.values.forEach((v) => idToValue.set(v.id, v.value)));
    const rows = cells.map((c) => {
      const ids = c.cell_key.split('|').map(Number);
      const row = {};
      axes.forEach((a, i) => { row[a.name.toLowerCase().replace(/\s+/g, '_')] = idToValue.get(ids[i]) || ''; });
      row.price = money(c.price).toFixed(2);
      return row;
    });
    return toCsv(header, rows);
  }
  if (mode === 'flat_option') {
    const rows = optionsFor(product.id).map((o) => ({ label: o.label, price: money(o.price).toFixed(2), sku_suffix: o.sku_suffix || '', sort_order: o.sort_order }));
    return toCsv(['label', 'price', 'sku_suffix', 'sort_order'], rows);
  }
  if (mode === 'sqft') {
    const rows = materialsFor(product.id).map((m) => ({ label: m.label, rate_per_sqft: money(m.rate_per_sqft).toFixed(2), allows_double_sided: m.allows_double_sided ? 'true' : 'false', sort_order: m.sort_order }));
    return toCsv(['label', 'rate_per_sqft', 'allows_double_sided', 'sort_order'], rows);
  }
  throw new Error(`Pricing mode "${mode}" has nothing to export (only matrix, flat_option and sqft are importable).`);
}
