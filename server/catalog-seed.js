// One-time catalog backfill: gives the 15 seeded products the website-facing
// content Frank manages from Products — copy, multiple images, size/dimension
// variants, quantity price breaks and the "Design it for me" flag.
// Guarded by the `catalog_backfill_v2` setting so it never runs twice and never
// stomps edits Frank has made.
import { db, getSetting, setSetting } from './db.js';

const IMG = (n) => `/brand/products/${n}.jpg`;

const APPAREL_SIZES = [
  ['S', 0], ['M', 0], ['L', 0], ['XL', 0], ['2XL', 2], ['3XL', 3], ['4XL', 4],
];

/** sku → catalog content. images[0] becomes the primary. */
export const CATALOG = {
  'SP-TEE-1C': {
    badge: 'Best seller',
    short: 'One-color plastisol print on a heavy cotton tee — the tri-county workhorse.',
    long: 'Gildan 5000 heavyweight cotton, one screen, one ink color, printed on our six-station manual press in Williston. Screens and separations stay on file, so reorders skip the setup charge. Union-cut sizing runs true; pick your garment color and we will match ink for contrast. Minimum 24 pieces, mixed sizes welcome — tell us the size breakdown at checkout and we count it into the run.',
    images: ['screenprint-tee', 'press-run', 'shop-team', 'artwork-proof'],
    sizes: APPAREL_SIZES,
    tiers: [[24, 8.5], [48, 7.75], [96, 6.95]],
    design: 45,
  },
  'SP-TEE-3C': {
    short: 'Three-color spot print, registered by hand for logos with outline plus fill.',
    long: 'Three screens, three inks, registered on the manual press with a tight fit. Ideal for team logos that need a fill, an outline and a highlight. Includes a digital proof before we burn screens and a press check on the first pull. Add a back or sleeve hit at quote time.',
    images: ['press-run', 'screenprint-tee', 'artwork-proof', 'shop-team'],
    sizes: APPAREL_SIZES,
    tiers: [[24, 12.75], [48, 11.5], [96, 10.25]],
    design: 45,
  },
  'DTF-TEE': {
    badge: '4-day turnaround',
    short: 'Full-color direct-to-film transfer — no screen charges, great for short runs.',
    long: 'Direct-to-film transfers give photographic color, gradients and fine detail with zero screen setup, which makes small runs and one-offs affordable. Pressed at 305°F for a soft hand that survives the wash. Six-piece minimum, youth through 3XL, and artwork can be a JPG straight off your phone.',
    images: ['dtf-tee', 'press-run', 'artwork-proof', 'shop-team'],
    sizes: [['YS', 0], ['YM', 0], ['YL', 0], ...APPAREL_SIZES],
    tiers: [[6, 14], [24, 12.5], [48, 11.25]],
    design: 45,
  },
  'EMB-POLO': {
    short: 'Moisture-wicking polo with an 8,000-stitch left-chest logo.',
    long: 'Performance polo in a snag-resistant knit, embroidered up to 8,000 stitches on the left chest. Digitizing is a one-time $25 setup and free on every reorder after that. Thread matched to your brand colors from the Madeira book — we will send a stitch-out photo before the full run.',
    images: ['embroidered-polo', 'embroidered-cap', 'shop-team', 'artwork-proof'],
    sizes: [['S', 0], ['M', 0], ['L', 0], ['XL', 0], ['2XL', 2.5], ['3XL', 4], ['4XL', 5.5]],
    design: 45,
  },
  'EMB-CAP': {
    short: '3D puff or flat embroidery on a structured, trucker or dad-hat crown.',
    long: 'Pheasant-season favorite. Choose a structured six-panel, a trucker mesh back or an unstructured dad hat, then flat or 3D puff embroidery on the front panel. Twelve-piece minimum per style; mix crown colors inside one run at no extra charge.',
    images: ['embroidered-cap', 'embroidered-polo', 'shop-team'],
    options: [['Structured 6-panel', 0], ['Trucker mesh', 0], ['Unstructured dad hat', 1]],
    design: 45,
  },
  'SP-HOOD': {
    short: '50/50 pullover hoodie with up to two print colors included.',
    long: 'Heavyweight 50/50 pullover with a lined hood and front pouch pocket. Two print colors are included in the base price — add a hood-liner print or a sleeve hit for a few dollars more. Runs warm and boxy; order a size down for a fitted look.',
    images: ['hoodie', 'screenprint-tee', 'press-run', 'shop-team'],
    sizes: [['S', 0], ['M', 0], ['L', 0], ['XL', 0], ['2XL', 3], ['3XL', 5], ['4XL', 6.5]],
    tiers: [[12, 28], [36, 26], [72, 24.5]],
    design: 45,
  },
  'VIN-DECAL': {
    short: 'Weeded and taped 5-year outdoor vinyl, cut to your artwork.',
    long: 'Plotter-cut from calendared 5-year outdoor vinyl, weeded, taped with an application layer and shipped flat with instructions. Great for equipment numbers, window graphics, tailgates and toolboxes. Vector artwork gives the cleanest cut, but we can trace a clean raster file for you.',
    images: ['vinyl-decal', 'door-lettering', 'artwork-proof'],
    dimensions: [['Up to 6"', null, 4.5], ['Up to 12"', null, 6], ['Up to 24"', null, 14]],
  },
  'VIN-DOOR': {
    short: 'DOT-compliant name, town and phone for both truck doors, installed.',
    long: 'Everything a service truck needs to stay legal: business name, city/state and phone, sized and spaced for both doors. Includes a layout proof, premium cast vinyl and installation at our Williston shop. Ship-flat is available if your truck lives out of town.',
    images: ['door-lettering', 'vinyl-decal', 'shop-hero'],
    options: [['2 lines', 0], ['3 lines', 0], ['4 lines', 20]],
    design: 55,
  },
  'BAN-13OZ': {
    badge: 'Shop favorite',
    short: 'Full-color 13oz scrim vinyl, hemmed with grommets every two feet.',
    long: 'Solvent-printed on 13oz scrim vinyl, hemmed on all four sides with brass grommets every two feet. Rated for multiple seasons outdoors in South Dakota wind. Priced by the square foot with common sizes below; pole pockets and double-sided builds are quoted on request.',
    images: ['vinyl-banner', 'yard-signs', 'shop-hero'],
    dimensions: [['2x4 ft', null, 34], ['3x6 ft', null, 76.5], ['3x8 ft', null, 102], ['4x8 ft', null, 136]],
    design: 55,
  },
  'SGN-YARD': {
    badge: 'Popular',
    short: '4mm coroplast yard sign, full color, H-stakes included.',
    long: 'Full-color print on 4mm corrugated plastic with an H-stake for every sign. Election season, real estate listings, ballfield sponsors and grand openings all live here. Single- or double-sided; ten-piece minimum with steep breaks at 50 and 100.',
    images: ['yard-signs', 'vinyl-banner', 'shop-hero'],
    dimensions: [['18x24', 0, null], ['24x36', 8, null]],
    design: 55,
  },
  'BLU-2436': {
    short: 'Large-format bond plotting for construction sets and site plans.',
    long: 'Wide-format plotting on 20lb bond, vellum or mylar, up to 36" wide. Files in before 2pm print same day. We keep job folders on file for the general contractors we work with so revisions are a one-line email.',
    images: ['blueprints', 'press-run', 'shop-hero'],
    dimensions: [['18x24', null, 4.5], ['24x36', null, 6.5], ['30x42', null, 9.5], ['36x48', null, 12]],
  },
  'BUS-TICKET': {
    short: 'Numbered 2- or 3-part carbonless work-order books with wrap cover.',
    long: 'Sequentially numbered carbonless books, 50 sets each, wrap cover and chipboard back so they hold up in a service truck. Two-part white/canary is standard; three-part adds a pink file copy. We keep your numbering sequence on file so the next run picks up where the last one stopped.',
    images: ['ticket-books', 'business-cards', 'press-run'],
    tiers: [[10, 32], [25, 29.5], [50, 27]],
  },
  'BUS-CARD': {
    short: '16pt stock, full color both sides, 500 to the box.',
    long: 'Thick 16pt stock in matte, gloss UV or soft-touch, printed full color front and back. Free layout tweak from the logo file you already have. Boxed 500 to the carton with sequential proofs emailed before we run.',
    images: ['business-cards', 'flyers', 'artwork-proof'],
    tiers: [[1, 65], [3, 58], [6, 52]],
  },
  'BUS-FLYER': {
    short: '100lb gloss text, full bleed, 500 to the box.',
    long: 'Full-bleed 8.5x11 flyers on 100lb gloss text — co-op field days, band nights, grand openings and church bulletins. Folding is available at the bindery: half, tri-fold or Z-fold. Camera-ready PDFs preferred, but we will lay it out for you.',
    images: ['flyers', 'business-cards', 'press-run'],
    tiers: [[1, 95], [3, 86], [6, 78]],
  },
  'PRO-TUMB': {
    short: 'Powder-coated 20oz stainless tumbler with a permanent laser mark.',
    long: 'Double-wall vacuum stainless tumbler in a powder-coat finish, laser-etched so the mark never peels. Retirement gifts, crew swag and customer-appreciation giveaways. Six-piece minimum, engrave one or both sides.',
    images: ['tumbler', 'shop-team', 'artwork-proof'],
    options: [['One side engraved', 0], ['Two sides engraved', 5]],
  },
};

export function seedCatalog() {
  if (getSetting('catalog_backfill_v2')) return;

  const products = db.prepare('SELECT * FROM products').all();
  if (products.length === 0) return;

  const upd = db.prepare(`UPDATE products SET published=1, badge=?, short_description=?, long_description=?,
    design_service_enabled=?, design_service_fee=?, allow_artwork_upload=1, website_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`);
  const clearImgs = db.prepare('DELETE FROM product_images WHERE product_id=?');
  const insImg = db.prepare('INSERT INTO product_images (product_id,url,alt,is_primary,sort_order) VALUES (?,?,?,?,?)');
  const insVar = db.prepare(`INSERT INTO product_variants (product_id,label,kind,price,upcharge,sku_suffix,stock,active,sort_order)
    VALUES (?,?,?,?,?,?,NULL,1,?)`);
  const insTier = db.prepare('INSERT INTO price_tiers (product_id,min_qty,unit_price) VALUES (?,?,?)');
  const clearVar = db.prepare('DELETE FROM product_variants WHERE product_id=?');
  const clearTier = db.prepare('DELETE FROM price_tiers WHERE product_id=?');
  const setPrimaryImage = db.prepare('UPDATE products SET image_url=? WHERE id=?');

  db.transaction(() => {
    products.forEach((p, i) => {
      const c = CATALOG[p.sku];
      if (!c) return;
      upd.run(c.badge || null, c.short || null, c.long || null, c.design ? 1 : 0, c.design || 0, i + 1, p.id);

      clearImgs.run(p.id);
      (c.images || []).forEach((name, idx) => {
        insImg.run(p.id, IMG(name), `${p.name} — photo ${idx + 1}`, idx === 0 ? 1 : 0, idx);
      });
      if (c.images?.length) setPrimaryImage.run(IMG(c.images[0]), p.id);

      clearVar.run(p.id);
      let sort = 0;
      for (const [label, up] of c.sizes || []) insVar.run(p.id, label, 'size', null, up || 0, label.replace(/\W/g, ''), sort++);
      for (const [label, up, price] of c.dimensions || []) insVar.run(p.id, label, 'dimension', price ?? null, price != null ? null : (up || 0), label.replace(/\W/g, ''), sort++);
      for (const [label, up] of c.options || []) insVar.run(p.id, label, 'option', null, up || 0, null, sort++);

      clearTier.run(p.id);
      for (const [minQty, unit] of c.tiers || []) insTier.run(p.id, minQty, unit);
    });
  })();

  setSetting('catalog_backfill_v2', new Date().toISOString());
}
