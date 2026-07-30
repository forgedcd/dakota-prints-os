import { chromium } from 'playwright';
const BASE = 'http://localhost:5055';
const OUT = '/home/user/workspace/dakota-prints-admin-os/qa-screens';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 1400 } });
p.setDefaultTimeout(15000);
await p.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
await p.fill('input[type="email"]', 'admin@dakotaprints.com');
await p.fill('input[type="password"]', 'ForgedOS2026!');
await p.click('button:has-text("Sign in")');
await p.waitForTimeout(1200);
await p.goto(`${BASE}/#/products`, { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.locator('input.field').first().fill('Stapled Ticket Books — Black');
await p.waitForTimeout(700);
const card = p.locator('text=Stapled Ticket Books').first().locator('xpath=ancestor::li[1]');
await card.waitFor({ state: 'visible', timeout: 10000 });
await card.locator('button:has-text("Edit")').click();
await p.waitForTimeout(600);
await p.locator('button:has-text("Pricing")').first().click();
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/04-editor-pricing-matrix-mobile-full.png`, fullPage: true });

// Scroll to importer panel (bottom of pricing tab, shared for non-tiered modes)
await p.locator('div.overflow-y-auto').first().evaluate(el => el.scrollTo(0, el.scrollHeight));
await p.waitForTimeout(500);
await p.screenshot({ path: `${OUT}/08-csv-importer-mobile.png` });

await b.close();
console.log('done');
