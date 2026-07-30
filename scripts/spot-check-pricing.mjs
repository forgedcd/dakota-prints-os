#!/usr/bin/env node
// Spot-check script — verifies the live public pricing API resolves prices
// that are cent-exact matches to the source CSVs / pricing doc in
// /home/user/workspace/pricing-source, using the SAME endpoint the website
// will call (POST /api/public/quote). Also asserts that known-bad inputs are
// rejected server-side. Run with the OS server already booted:
//
//   node scripts/spot-check-pricing.mjs [baseUrl]
//
// Exit code 0 = all checks passed, 1 = at least one failure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:5055';
const SOURCE_DIR = '/home/user/workspace/pricing-source';

let pass = 0;
let fail = 0;
const lines = [];

function log(msg) { lines.push(msg); console.log(msg); }

// Proper RFC4180-ish CSV parser: handles quoted fields with embedded commas
// and escaped double-quotes ("" -> "), which the source CSVs use for sizes
// like "8.5"" x 11"".
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
  const [headerLine, ...rows] = text.split('\n');
  const headers = parseCsvLine(headerLine).map((h) => h.trim());
  return rows.filter((l) => l.trim().length).map((line) => {
    const cells = parseCsvLine(line).map((c) => c.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
}

async function quote(body) {
  const r = await fetch(`${BASE}/api/public/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

function assertEqual(label, actual, expected) {
  const bothNumeric = !Number.isNaN(Number(actual)) && !Number.isNaN(Number(expected)) && actual !== '' && expected !== '';
  const ok = bothNumeric ? Math.abs(Number(actual) - Number(expected)) < 0.005 : actual === expected;
  if (ok) {
    pass++;
    log(`  PASS  ${label}  ->  ${actual} (expected ${expected})`);
  } else {
    fail++;
    log(`  FAIL  ${label}  ->  got ${actual}, expected ${expected}`);
  }
  return ok;
}

function assertTrue(label, condition, detail = '') {
  if (condition) {
    pass++;
    log(`  PASS  ${label}${detail ? '  (' + detail + ')' : ''}`);
  } else {
    fail++;
    log(`  FAIL  ${label}${detail ? '  (' + detail + ')' : ''}`);
  }
  return condition;
}

async function getProduct(slug) {
  const r = await fetch(`${BASE}/api/public/products/${slug}`);
  if (!r.ok) throw new Error(`Failed to fetch product ${slug}: ${r.status}`);
  return r.json();
}

// Build a lookup: axis name -> { value -> axis_value_id } for a matrix product's public pricing.axes
function axisValueIndex(product) {
  const idx = {};
  for (const axis of product.pricing.axes) {
    idx[axis.name] = {};
    for (const v of axis.values) idx[axis.name][v.value] = v.id;
  }
  return idx;
}

async function checkMatrixProduct(slug, csvFile, label) {
  log(`\n=== ${label} (${slug}) vs ${path.basename(csvFile)} ===`);
  const product = await getProduct(slug);
  const idx = axisValueIndex(product);
  const rows = parseCsv(path.join(SOURCE_DIR, csvFile));

  // Pick a deterministic, spread-out sample: first, last, and every ~12th row,
  // to reach >=20 cells per file with variety across all three axes.
  const sampleRows = rows.filter((_, i) => i % 3 === 0); // ~21 of 63 rows
  let checked = 0;
  for (const row of sampleRows) {
    const sizeId = idx['Finished size']?.[row.size];
    const partsId = idx['Parts']?.[row.parts];
    const qtyId = idx['Quantity']?.[row.qty_label];
    if (!sizeId || !partsId || !qtyId) {
      fail++;
      log(`  FAIL  axis lookup for size=${row.size} parts=${row.parts} qty_label=${row.qty_label} (ids: ${sizeId},${partsId},${qtyId})`);
      continue;
    }
    const { status, json } = await quote({
      slug,
      qty: 1,
      selection: { axis_value_ids: [sizeId, partsId, qtyId] },
    });
    const label2 = `${row.size} / ${row.parts} / ${row.qty_label}`;
    if (status !== 200) {
      fail++;
      log(`  FAIL  ${label2}  -> HTTP ${status} ${JSON.stringify(json)}`);
      continue;
    }
    assertEqual(label2, json.line_total, row.price);
    checked++;
  }
  log(`  (checked ${checked} matrix cells for ${label})`);
  return checked;
}

async function checkBanner() {
  log(`\n=== Vinyl Banners (sqft) ===`);
  const product = await getProduct('vinyl-banners');
  const mats = product.pricing.materials;
  const mat13 = mats.find((m) => m.label === '13oz');
  const mat18 = mats.find((m) => m.label === '18oz');
  assertTrue('13oz material present', !!mat13);
  assertTrue('18oz material present', !!mat18);
  assertEqual('13oz rate/sqft', mat13.rate_per_sqft, 5.5);
  assertEqual('18oz rate/sqft', mat18.rate_per_sqft, 6.5);
  assertTrue('13oz does NOT allow double-sided', mat13.allows_double_sided === false);
  assertTrue('18oz allows double-sided', mat18.allows_double_sided === true);

  // 13oz single-sided, 4ft x 8ft = 32 sqft (well above minimum) -> 32 * 5.50 = 176.00
  {
    const { status, json } = await quote({
      slug: 'vinyl-banners', qty: 1,
      selection: { material_id: mat13.id, width_in: 48, height_in: 96, double_sided: false },
    });
    assertTrue('13oz 4x8ft single-sided HTTP 200', status === 200, `status=${status}`);
    if (status === 200) assertEqual('13oz 4x8ft single-sided total (32 sqft * $5.50)', json.line_total, 32 * 5.5);
  }

  // 18oz double-sided, 3ft x 4ft = 12 sqft -> 12 * 6.50 * 2 = 156.00
  {
    const { status, json } = await quote({
      slug: 'vinyl-banners', qty: 1,
      selection: { material_id: mat18.id, width_in: 36, height_in: 48, double_sided: true },
    });
    assertTrue('18oz 3x4ft double-sided HTTP 200', status === 200, `status=${status}`);
    if (status === 200) assertEqual('18oz 3x4ft double-sided total (12 sqft * $6.50 * 2)', json.line_total, 12 * 6.5 * 2);
  }

  // 18oz single-sided qty=3, 2ft x 3ft = 6 sqft -> 6 * 6.50 * 3 = 117.00
  {
    const { status, json } = await quote({
      slug: 'vinyl-banners', qty: 3,
      selection: { material_id: mat18.id, width_in: 24, height_in: 36, double_sided: false },
    });
    assertTrue('18oz 2x3ft single-sided qty=3 HTTP 200', status === 200, `status=${status}`);
    if (status === 200) assertEqual('18oz 2x3ft single-sided qty=3 total (6 sqft * $6.50 * 3)', json.line_total, 6 * 6.5 * 3);
  }

  // Minimum-sqft floor: 13oz, tiny 6in x 6in = 0.25 sqft, floored to minimum_sqft (1)
  // -> billed at 1 sqft * 5.50 = 5.50, NOT 0.25*5.50=1.375
  {
    const { status, json } = await quote({
      slug: 'vinyl-banners', qty: 1,
      selection: { material_id: mat13.id, width_in: 6, height_in: 6, double_sided: false },
    });
    assertTrue('13oz tiny 6x6in HTTP 200', status === 200, `status=${status}`);
    if (status === 200) {
      assertEqual('13oz tiny 6x6in floored to minimum_sqft (1 * $5.50)', json.line_total, 1 * 5.5);
      assertEqual('meta.billed_sqft reflects the floor', json.meta.billed_sqft, 1);
      assertTrue('meta.exact_sqft is the true (unfloored) value', Math.abs(json.meta.exact_sqft - 0.25) < 0.001, `exact_sqft=${json.meta.exact_sqft}`);
    }
  }

  // VALIDATION: double-sided 13oz banner must be REJECTED
  {
    const { status, json } = await quote({
      slug: 'vinyl-banners', qty: 1,
      selection: { material_id: mat13.id, width_in: 48, height_in: 96, double_sided: true },
    });
    assertTrue('double-sided 13oz banner REJECTED (400)', status === 400, `status=${status} body=${JSON.stringify(json)}`);
    assertTrue('rejection code is double_sided_not_allowed', json.code === 'double_sided_not_allowed', `code=${json.code}`);
  }

  // VALIDATION: invalid dimensions (zero) rejected
  {
    const { status, json } = await quote({
      slug: 'vinyl-banners', qty: 1,
      selection: { material_id: mat18.id, width_in: 0, height_in: 24, double_sided: false },
    });
    assertTrue('zero width REJECTED (400)', status === 400, `status=${status}`);
    assertTrue('rejection code is invalid_dimensions', json.code === 'invalid_dimensions', `code=${json.code}`);
  }
}

async function checkPoster() {
  log(`\n=== Large Format Posters (sqft, single-sided only, $4.50) ===`);
  const product = await getProduct('large-format-posters');
  assertEqual('rate_per_sqft', product.pricing.rate_per_sqft, 4.5);
  assertTrue('no materials list (single default rate)', (product.pricing.materials || []).length === 0);

  // 2ft x 3ft = 6 sqft -> 6 * 4.50 = 27.00
  const { status, json } = await quote({
    slug: 'large-format-posters', qty: 1,
    selection: { width_in: 24, height_in: 36, double_sided: false },
  });
  assertTrue('poster 2x3ft HTTP 200', status === 200, `status=${status}`);
  if (status === 200) assertEqual('poster 2x3ft total (6 sqft * $4.50)', json.line_total, 6 * 4.5);
}

async function checkFlatOptionProducts() {
  log(`\n=== Business Cards (flat_option) ===`);
  const bc = await getProduct('business-cards');
  const opt250 = bc.pricing.options.find((o) => o.label.includes('250'));
  const opt500 = bc.pricing.options.find((o) => o.label.includes('500'));
  assertTrue('250-card option present', !!opt250);
  assertTrue('500-card option present', !!opt500);
  assertEqual('250 cards price', opt250.price, 85.0);
  assertEqual('500 cards price', opt500.price, 95.0);

  {
    const { status, json } = await quote({ slug: 'business-cards', qty: 1, selection: { option_id: opt250.id } });
    assertTrue('250 cards qty=1 HTTP 200', status === 200);
    if (status === 200) assertEqual('250 cards qty=1 total', json.line_total, 85.0);
  }
  {
    // qty multiplies the option price per spec
    const { status, json } = await quote({ slug: 'business-cards', qty: 2, selection: { option_id: opt500.id } });
    assertTrue('500 cards qty=2 HTTP 200', status === 200);
    if (status === 200) assertEqual('500 cards qty=2 total (2 x $95.00)', json.line_total, 190.0);
  }

  log(`\n=== Engineering Drawings (flat_option, per-sheet) ===`);
  const ed = await getProduct('engineering-drawings');
  assertEqual('unit_label is "per sheet"', ed.unit_label, 'per sheet');
  const o1117 = ed.pricing.options.find((o) => o.label.includes('11') && o.label.includes('17'));
  const o2436 = ed.pricing.options.find((o) => o.label.includes('24') && o.label.includes('36'));
  const o4032 = ed.pricing.options.find((o) => o.label.includes('40') && o.label.includes('32'));
  assertTrue('11x17 option present', !!o1117);
  assertTrue('24x36 option present', !!o2436);
  assertTrue('40x32 option present', !!o4032);
  assertEqual('11x17 price/sheet', o1117.price, 1.25);
  assertEqual('24x36 price/sheet', o2436.price, 4.5);
  assertEqual('40x32 price/sheet', o4032.price, 5.0);

  {
    // per-sheet: qty multiplies -> 10 sheets of 11x17 = 12.50
    const { status, json } = await quote({ slug: 'engineering-drawings', qty: 10, selection: { option_id: o1117.id } });
    assertTrue('11x17 x10 sheets HTTP 200', status === 200);
    if (status === 200) assertEqual('11x17 x10 sheets total (10 x $1.25)', json.line_total, 12.5);
  }
  {
    // 3 sheets of 40x32 = 15.00
    const { status, json } = await quote({ slug: 'engineering-drawings', qty: 3, selection: { option_id: o4032.id } });
    assertTrue('40x32 x3 sheets HTTP 200', status === 200);
    if (status === 200) assertEqual('40x32 x3 sheets total (3 x $5.00)', json.line_total, 15.0);
  }

  // VALIDATION: unknown option rejected
  {
    const { status, json } = await quote({ slug: 'engineering-drawings', qty: 1, selection: { option_id: 999999 } });
    assertTrue('unknown flat_option id REJECTED (400)', status === 400, `status=${status}`);
    assertTrue('rejection code is unknown_option', json.code === 'unknown_option', `code=${json.code}`);
  }
}

async function checkMatrixValidation() {
  log(`\n=== Matrix validation ===`);
  const product = await getProduct('stapled-ticket-books-black-white');
  const idx = axisValueIndex(product);
  const sizeId = Object.values(idx['Finished size'])[0];
  const partsId = Object.values(idx['Parts'])[0];

  // Unknown axis combination: use a valid size + valid parts but swap in a
  // qty axis value id from a DIFFERENT product's axis (guaranteed foreign id
  // still an integer, but not a member of THIS product's Quantity axis).
  const otherProduct = await getProduct('glued-edge-books-black-white');
  const otherIdx = axisValueIndex(otherProduct);
  const foreignQtyId = Object.values(otherIdx['Quantity'])[0];

  {
    const { status, json } = await quote({
      slug: 'stapled-ticket-books-black-white', qty: 1,
      selection: { axis_value_ids: [sizeId, partsId, foreignQtyId] },
    });
    assertTrue('foreign axis-value id REJECTED (400)', status === 400, `status=${status} body=${JSON.stringify(json)}`);
    assertTrue('rejection code is unknown_axis_value', json.code === 'unknown_axis_value', `code=${json.code}`);
  }

  // Incomplete selection (missing one axis id)
  {
    const { status, json } = await quote({
      slug: 'stapled-ticket-books-black-white', qty: 1,
      selection: { axis_value_ids: [sizeId, partsId] },
    });
    assertTrue('incomplete axis selection REJECTED (400)', status === 400, `status=${status}`);
    assertTrue('rejection code is incomplete_selection', json.code === 'incomplete_selection', `code=${json.code}`);
  }
}

async function main() {
  log(`Dakota Prints OS — pricing spot-check`);
  log(`Base URL: ${BASE}`);
  log(`Run at: ${new Date().toISOString()}`);

  let totalMatrixChecked = 0;
  totalMatrixChecked += await checkMatrixProduct('stapled-ticket-books-black-white', 'stapled-ticket-books-bw.csv', 'Stapled Ticket Books — Black & White');
  totalMatrixChecked += await checkMatrixProduct('stapled-ticket-books-full-color', 'stapled-ticket-books-color.csv', 'Stapled Ticket Books — Full Color');
  totalMatrixChecked += await checkMatrixProduct('glued-edge-books-black-white', 'glued-edge-bw.csv', 'Glued Edge Books — Black & White');
  totalMatrixChecked += await checkMatrixProduct('glued-edge-books-full-color', 'glued-edge-color.csv', 'Glued Edge Books — Full Color');

  await checkBanner();
  await checkPoster();
  await checkFlatOptionProducts();
  await checkMatrixValidation();

  log(`\n=== SUMMARY ===`);
  log(`Matrix cells checked: ${totalMatrixChecked} (>= 20 required)`);
  log(`Total assertions: ${pass + fail}  |  PASS: ${pass}  |  FAIL: ${fail}`);
  log(fail === 0 ? 'RESULT: ALL CHECKS PASSED' : 'RESULT: FAILURES PRESENT — SEE ABOVE');

  const outPath = path.join(__dirname, '..', 'qa-screens', 'spot-check-output.txt');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
  log(`\nFull output saved to ${outPath}`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Spot-check script crashed:', e);
  process.exit(1);
});
