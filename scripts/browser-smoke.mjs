import puppeteer from 'puppeteer-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] ?? 'http://127.0.0.1:5174/';
const errors = [];
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});
try {
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.stack || err.message}`));
  page.on('requestfailed', (req) => errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText}`));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.setup-page', { timeout: 10000 });
  await page.screenshot({ path: 'smoke-setup.png' });
  await page.click('.hero-actions .primary');
  await page.waitForSelector('.live-page canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.click('.playback .speed:last-child');
  await new Promise((r) => setTimeout(r, 6500));
  await page.click('.flip-all').catch(() => {});
  await page.screenshot({ path: 'smoke-live.png' });
  await new Promise((r) => setTimeout(r, 7500));
  await page.click('.flip-all').catch(() => {});

  await page.waitForSelector('.complete-overlay:not([hidden])', { timeout: 120000 });
  await page.screenshot({ path: 'smoke-complete.png' });
  await page.click('.complete-actions .gold');
  await page.waitForSelector('.result-page', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'smoke-result.png' });
  await page.click('.result-actions .gold');
  await page.waitForSelector('.replay-page canvas', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: 'smoke-replay.png' });

  const metrics = await page.evaluate(() => document.querySelector('.result-page')?.innerText ?? '');
  console.log(metrics.slice(0, 1200));
  console.log('\nSMOKE_OK');
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('\nBROWSER_ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
}
