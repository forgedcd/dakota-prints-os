// Option-label helpers. Product options are stored labelled like
// "2XL (+$3.50)" or "Rush (+20%)" so the website can price them; in the OS we
// mostly need to strip or read those upcharges.

/** "2XL (+$3.50)" → 3.5 ; "Rush (+20%)" → -0.2 (negative marks a percentage add-on). */
export function upchargeOf(label?: string | null): number {
  if (!label) return 0;
  const flat = label.match(/\(\+\$([\d.]+)\)/);
  if (flat) return Number(flat[1]);
  const pct = label.match(/\(\+(\d+)%\)/);
  return pct ? -Number(pct[1]) / 100 : 0;
}

/** "2XL (+$3.50)" → "2XL" */
export function cleanLabel(label?: string | null) {
  return (label || '').replace(/\s*\((\+[^)]+)\)\s*/, '');
}
