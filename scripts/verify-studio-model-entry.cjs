// Browser regression for model-card entry, including reversed network order.
// STUDIO_TEST_URL selects a running app; PLAYWRIGHT_MODULE can point to a
// workspace-provided Playwright installation. No model inference is sent.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    const target = 'deepseek-v4-flash';
    for (const scenario of [
      { name: 'composer responds last', delays: [1200, 100], models: ['gpt-5.5', target] },
      { name: 'entry responds last', delays: [100, 1200], models: ['gpt-5.5', target] },
      { name: 'selected model beyond first 30', delays: [1200, 100], models: [...Array.from({length: 35}, (_,i) => `model-${i}`), target] },
      { name: 'unavailable model has an explanation', delays: [1200, 100], models: ['gpt-5.5'], unavailable: true },
    ]) {
      const page = await browser.newPage();
      let calls = 0;
      await page.route('**/api/capabilities', async route => {
        const delay = scenario.delays[calls++] ?? 100;
        await new Promise(resolve => setTimeout(resolve, delay));
        await route.fulfill({ json: { models: scenario.models, presets: [], degraded: false } });
      });
      const base = process.env.STUDIO_TEST_URL || 'http://localhost:3000';
      await page.goto(`${base}/studio?model=${target}&entry=model-catalog`, { waitUntil: 'networkidle' });
      const selection = page.locator('.composer-selected-model:visible');
      await selection.waitFor();
      if (scenario.unavailable) {
        await page.getByText(`当前账户暂不可用模型 ${target}，请在模型列表中选择可用模型。`, { exact: true }).first().waitFor();
      } else {
        assert.equal(await selection.getAttribute('aria-label'), `当前模型：${target}`, scenario.name);
        await selection.click();
        assert.ok(await page.getByText(target, { exact: true }).count(), 'requested model remains in picker');
      }
      console.log(`PASS: ${scenario.name}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
