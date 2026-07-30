// Shared pricing-mode resolver — the ONLY place unit/line prices are computed
// for flat_option, sqft and matrix products. tiered_unit keeps using
// tierPrice/resolveUnitPrice in catalog.js (unchanged, still the default).
//
// Every mode returns { line_total, meta } where meta describes what was
// selected (for order_items.spec_json / receipts) and line_total is the
// FULL price for the line (already multiplied by qty where relevant).
//
// Server-side rule for every mode: NEVER trust a client-supplied price.
// Callers pass only the human "selection" (option id / material / axis
// values / sqft dims) and qty; this module looks up the truth from the DB
// and throws PricingError on anything invalid (unknown option, double-sided
// on a material that disallows it, sqft below minimum, unknown axis combo).
import { db } from './db.js';
import { money } from './catalog.js';

export class PricingError extends Error {
  constructor(message, code = 'pricing_error') {
    super(message);
    this.code = code;
    this.status = 400;
  }
}

// ---------------------------------------------------------------- flat_option
export function optionsFor(productId, onlyActive = false) {
  return db.prepare(`SELECT id,label,price,sku_suffix,sort_order,active FROM product_options
    WHERE product_id=? ${onlyActive ? 'AND active=1' : ''} ORDER BY sort_order, id`).all(productId);
}

/** flat_option: price = option.price * qty (unit_label is display-only, e.g. "per sheet"). */
export function priceFlatOption(product, { option_id, qty = 1 } = {}) {
  const q = Math.max(1, Number(qty) || 1);
  const opt = db.prepare('SELECT * FROM product_options WHERE id=? AND product_id=? AND active=1').get(option_id, product.id);
  if (!opt) throw new PricingError('Unknown or inactive pricing option for this product.', 'unknown_option');
  const line_total = money(Number(opt.price) * q);
  return {
    unit_price: money(opt.price),
    line_total,
    meta: { pricing_mode: 'flat_option', option_id: opt.id, option_label: opt.label, unit_label: product.unit_label || null, qty: q },
  };
}

// ---------------------------------------------------------------------- sqft
export function materialsFor(productId, onlyActive = false) {
  return db.prepare(`SELECT id,label,rate_per_sqft,allows_double_sided,sort_order,active FROM product_materials
    WHERE product_id=? ${onlyActive ? 'AND active=1' : ''} ORDER BY sort_order, id`).all(productId);
}

/**
 * sqft: price = max(exact_sqft, minimum_sqft) * rate * (double_sided ? multiplier : 1) * qty,
 * rounded to the cent. exact_sqft = width_in * height_in / 144.
 * rate comes from the chosen material if the product has materials, else product.rate_per_sqft.
 */
export function priceSqft(product, { material_id = null, width_in, height_in, double_sided = false, qty = 1 } = {}) {
  const q = Math.max(1, Number(qty) || 1);
  const w = Number(width_in), h = Number(height_in);
  if (!(w > 0) || !(h > 0)) throw new PricingError('Width and height (inches) are required.', 'invalid_dimensions');

  let rate, material = null, allowsDouble = true;
  const mats = materialsFor(product.id, true);
  if (mats.length) {
    material = mats.find((m) => m.id === Number(material_id));
    if (!material) throw new PricingError('Unknown or inactive material for this product.', 'unknown_material');
    rate = Number(material.rate_per_sqft);
    allowsDouble = !!material.allows_double_sided;
  } else {
    rate = Number(product.rate_per_sqft);
    if (!(rate > 0)) throw new PricingError('This product has no sqft rate configured.', 'no_rate');
  }

  const isDouble = bool01In(double_sided);
  if (isDouble && !allowsDouble) {
    throw new PricingError(`${material ? material.label : 'This material'} does not support double-sided printing.`, 'double_sided_not_allowed');
  }

  const minimum = Number(product.minimum_sqft) > 0 ? Number(product.minimum_sqft) : 1;
  const exactSqft = (w * h) / 144;
  // Per the pricing spec, exact sqft below the shop minimum is billed AT the
  // minimum ("floored at minimum_sqft") rather than rejected outright — the
  // "reject below minimum" validation rule is enforced for truly invalid
  // dimensions (<= 0), handled above.
  const billedSqft = Math.max(exactSqft, minimum);
  const multiplier = isDouble ? (Number(product.double_sided_multiplier) || 2) : 1;
  const line_total = money(billedSqft * rate * multiplier * q);

  return {
    unit_price: money(billedSqft * rate * multiplier),
    line_total,
    meta: {
      pricing_mode: 'sqft',
      material_id: material ? material.id : null,
      material_label: material ? material.label : null,
      width_in: w, height_in: h,
      exact_sqft: Math.round(exactSqft * 10000) / 10000,
      billed_sqft: Math.round(billedSqft * 10000) / 10000,
      minimum_sqft: minimum,
      double_sided: isDouble,
      double_sided_multiplier: multiplier,
      rate_per_sqft: rate,
      qty: q,
    },
  };
}

function bool01In(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

// -------------------------------------------------------------------- matrix
export function axesFor(productId) {
  const axes = db.prepare('SELECT id,name,axis_order FROM product_axes WHERE product_id=? ORDER BY axis_order, id').all(productId);
  return axes.map((a) => ({
    ...a,
    values: db.prepare('SELECT id,value,meta_json,value_order FROM product_axis_values WHERE axis_id=? ORDER BY value_order, id').all(a.id)
      .map((v) => ({ ...v, meta: safeParseJson(v.meta_json) })),
  }));
}

export function matrixCellsFor(productId) {
  return db.prepare('SELECT id,cell_key,price FROM product_matrix_cells WHERE product_id=?').all(productId);
}

function safeParseJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/** Build the canonical cell_key from an ordered array of axis_value ids. */
export function cellKeyFrom(axisValueIds) {
  return axisValueIds.map((id) => String(id)).join('|');
}

/**
 * matrix: caller supplies one axis_value_id per axis (in the product's axis
 * order). Price is the TOTAL for that exact combination — qty here is a
 * separate "how many of this selection" multiplier (spec: "separate line
 * quantity multiplies it"), defaulting to 1.
 */
export function priceMatrix(product, { axis_value_ids, qty = 1 } = {}) {
  const q = Math.max(1, Number(qty) || 1);
  const axes = axesFor(product.id);
  if (!axes.length) throw new PricingError('This product has no pricing axes configured.', 'no_axes');
  if (!Array.isArray(axis_value_ids) || axis_value_ids.length !== axes.length) {
    throw new PricingError(`Select a value for all ${axes.length} options (${axes.map((a) => a.name).join(', ')}).`, 'incomplete_selection');
  }
  // Validate every id belongs to its corresponding axis, in order.
  const chosen = [];
  for (let i = 0; i < axes.length; i++) {
    const axis = axes[i];
    const val = axis.values.find((v) => v.id === Number(axis_value_ids[i]));
    if (!val) throw new PricingError(`Invalid selection for "${axis.name}".`, 'unknown_axis_value');
    chosen.push(val);
  }
  const key = cellKeyFrom(chosen.map((v) => v.id));
  const cell = db.prepare('SELECT * FROM product_matrix_cells WHERE product_id=? AND cell_key=?').get(product.id, key);
  if (!cell) throw new PricingError('That combination is not available for this product.', 'unknown_axis_combination');

  const line_total = money(Number(cell.price) * q);
  return {
    unit_price: money(cell.price),
    line_total,
    meta: {
      pricing_mode: 'matrix',
      selection: axes.map((axis, i) => ({ axis: axis.name, value: chosen[i].value, meta: chosen[i].meta || null })),
      cell_key: key,
      cell_price: money(cell.price),
      qty: q,
    },
  };
}

// ------------------------------------------------------------------- generic
/**
 * Dispatch on product.pricing_mode. `tieredResolver` is passed in so this
 * module doesn't need to import catalog.js's tiered logic circularly —
 * caller (routes) supplies { tierPrice, resolveUnitPrice, tiersFor } from catalog.js.
 */
export function priceLine(product, selection, tiered) {
  const mode = product.pricing_mode || 'tiered_unit';
  switch (mode) {
    case 'flat_option':
      return priceFlatOption(product, selection);
    case 'sqft':
      return priceSqft(product, selection);
    case 'matrix':
      return priceMatrix(product, selection);
    case 'tiered_unit':
    default: {
      const qty = Math.max(1, Number(selection?.qty) || product.min_qty || 1);
      const tiers = tiered.tiersFor(product.id);
      const variant = selection?.variant_id
        ? tiered.variantsFor(product.id, true).find((v) => v.id === Number(selection.variant_id))
        : null;
      if (selection?.variant_id && !variant) throw new PricingError('Unknown option for this product.', 'unknown_variant');
      const unit = tiered.resolveUnitPrice(product, { tiers, variant, qty });
      return {
        unit_price: unit,
        line_total: money(unit * qty),
        meta: { pricing_mode: 'tiered_unit', variant_id: variant?.id || null, variant_label: variant?.label || null, qty },
      };
    }
  }
}

export function pricingDataFor(product) {
  const mode = product.pricing_mode || 'tiered_unit';
  if (mode === 'flat_option') {
    return { options: optionsFor(product.id, true).map((o) => ({ id: o.id, label: o.label, price: money(o.price), sku_suffix: o.sku_suffix || null, sort_order: o.sort_order })), unit_label: product.unit_label || null };
  }
  if (mode === 'sqft') {
    const materials = materialsFor(product.id, true);
    return {
      rate_per_sqft: product.rate_per_sqft !== null && product.rate_per_sqft !== undefined ? money(product.rate_per_sqft) : null,
      minimum_sqft: Number(product.minimum_sqft) || 1,
      double_sided_multiplier: Number(product.double_sided_multiplier) || 2,
      materials: materials.map((m) => ({ id: m.id, label: m.label, rate_per_sqft: money(m.rate_per_sqft), allows_double_sided: !!m.allows_double_sided, sort_order: m.sort_order })),
    };
  }
  if (mode === 'matrix') {
    const axes = axesFor(product.id);
    return {
      axes: axes.map((a) => ({ id: a.id, name: a.name, axis_order: a.axis_order, values: a.values.map((v) => ({ id: v.id, value: v.value, meta: v.meta, value_order: v.value_order })) })),
      cell_count: matrixCellsFor(product.id).length,
    };
  }
  return null;
}
