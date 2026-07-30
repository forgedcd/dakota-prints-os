import { chromium } from 'playwright';

const BASE = 'http://localhost:5055';
const OUT = '/home/user/workspace/dakota-prints-admin-os/qa-screens';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 800 } });
p.setDefaultTimeout(15000);

await p.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'admin@dakotaprints.com');
await p.fill('input[type="password"]', 'ForgedOS2026!');
await p.click('button:has-text("Sign in")');
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/01-dashboard-mobile.png`, fullPage: true });

await p.goto(`${BASE}/#/products`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/02-products-list-mobile.png`, fullPage: true });

async function openProductPricing(name, filename) {
  await p.goto(`${BASE}/#/products`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const search = p.locator('input.field').first();
  await search.fill(name);
  await p.waitForTimeout(700);
  const card = p.locator(`text=${name}`).first().locator('xpath=ancestor::li[1]');
  await card.waitFor({ state: 'visible', timeout: 10000 });
  await card.locator('button:has-text("Edit")').click();
  await p.waitForTimeout(600);
  const pricingTab = p.locator('button:has-text("Pricing")').first();
  await pricingTab.waitFor({ state: 'visible', timeout: 10000 });
  await pricingTab.click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${filename}`, fullPage: true });
  const closeBtn = p.locator('[aria-label="Close"]').first();
  await closeBtn.click({ force: true });
  await p.waitForTimeout(500);
}

await openProductPricing('Stapled Ticket Books — Black & White', '04-editor-pricing-matrix-mobile.png');
await openProductPricing('Vinyl Banners', '05-editor-pricing-sqft-mobile.png');
await openProductPricing('BUS-CARD-FLAT', '06-editor-pricing-flat-mobile.png');

await p.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/07-settings-mobile.png`, fullPage: true });

await b.close();
console.log('mobile QA done');
