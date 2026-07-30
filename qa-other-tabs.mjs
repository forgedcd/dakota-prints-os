import { chromium } from 'playwright';
const BASE = 'http://localhost:5055';
const OUT = '/home/user/workspace/dakota-prints-admin-os/qa-screens';
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

// Sizes & options tab
const sizesTab = p.locator('button[role="tab"]:has-text("Sizes")');
await sizesTab.scrollIntoViewIfNeeded();
await sizesTab.click();
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/09-sizes-options-mobile.png`, fullPage: true });

// Images tab
const imagesTab = p.locator('button[role="tab"]:has-text("Images")');
await imagesTab.scrollIntoViewIfNeeded();
await imagesTab.click();
await p.waitForTimeout(700);
await p.screenshot({ path: `${OUT}/10-images-mobile.png`, fullPage: true });

// Design service tab (label may vary)
const dsTab = p.locator('button[role="tab"]:has-text("Design")');
const dsCount = await dsTab.count();
if (dsCount > 0) {
  await dsTab.first().scrollIntoViewIfNeeded();
  await dsTab.first().click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/11-design-service-mobile.png`, fullPage: true });
} else {
  console.log('no design tab found');
}
await b.close();
console.log('done');
