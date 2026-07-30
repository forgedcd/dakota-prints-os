import { chromium } from 'playwright';
const BASE = 'http://localhost:5055';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 900 } });
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
const heading = p.locator('text=Price grid').first();
await heading.scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
const info = await p.locator('.scroll-x').evaluateAll(els => els.map(el => ({
  cls: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth
})));
console.log(JSON.stringify(info, null, 2));
await b.close();
