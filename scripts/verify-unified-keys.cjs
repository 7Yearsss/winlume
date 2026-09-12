// Browser regression with mocked account APIs; does not mutate production data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let imported = false, disabled = false;
  const key = () => ({ id: imported ? 'local-old' : 'newapi:org:9', source: imported ? 'reizo' : 'new-api',
    name: '历史服务密钥', prefix: 'sk-test', status: disabled ? 'disabled' : 'active', createdAt: '2026-09-01T00:00:00Z',
    lastUsedAt: null, expiresAt: null, quotaLimit: null, usedQuota: 0, modelScopes: ['gpt-test'], ipAllowList: [],
    organizationId: 'org', ownerUserId: 'user', ownerName: 'Admin' });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/api/account/self') body = { success: true, data: { id: 'user', username: 'admin', platform_role: 'admin' } };
    else if (path === '/api/account/config') body = { success: true, data: {} };
    else if (path === '/api/console/keys/import') { imported = true; body = { imported: 1 }; }
    else if (path === '/api/console/keys/local-old') { disabled = route.request().postDataJSON().status === 'disabled'; body = { key: key() }; }
    else if (path === '/api/console/keys') body = { keys: [key()], organizations: [{ id: 'org', name: '工作区', role: 'owner' }], organizationId: 'org', studioStatus: 'ready' };
    else body = {};
    await route.fulfill({ json: body });
  });
  await page.goto((process.env.REIZO_TEST_URL || 'https://reizo-ai.com') + '/account/keys');
  await page.getByText('凭证可用', { exact: true }).waitFor();
  await page.getByRole('button', { name: '纳管历史密钥', exact: true }).click();
  await page.getByText('已纳管 1 把历史密钥，可在这里编辑和撤销。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByRole('button', { name: '启用', exact: true }).waitFor();
  await page.getByRole('button', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: '停用', exact: true }).waitFor();
  await page.screenshot({ path: 'output/unified-keys.png', fullPage: true });
  console.log('PASS: Studio status, adopt existing key, disable, enable (mock API responses)');
  await browser.close();
})().catch(error => { console.error(error.message); process.exit(1); });
