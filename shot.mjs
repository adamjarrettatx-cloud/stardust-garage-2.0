import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 600, height: 1100 }, deviceScaleFactor: 2 });
for (const v of ['door', 'override', 'blocked', 'panel-add', 'panel-edit']) {
  await p.goto(`http://localhost:3123/zz-preview?v=${v}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `/home/user/workspace/preview-${v}.png`, fullPage: true });
}
await b.close();
