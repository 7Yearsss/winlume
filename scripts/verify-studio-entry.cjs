// Public production assets + mocked APIs. No paid calls or production data writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const stale = JSON.stringify({tabs:[{id:'old',kind:'session',sessionId:'foreign-session',title:'新对话'}],activeTabId:'old'});
      localStorage.setItem('reizo:studio-workspace-tabs', stale);
      localStorage.setItem('reizo:studio-workspace-tabs:new-user', stale);
    });
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/api/sessions/')) return route.fulfill({status:404,json:{error:'Not found'}});
      let body = {sessions:[],projects:[],skills:[],models:[],data:[]};
      if(path==='/api/account/self') body={success:true,data:{id:'new-user',username:'new-user'}};
      if(path==='/api/account/config') body={success:true,data:{}};
      await route.fulfill({json:body});
    });
    for (const model of ['gpt-6-astra','gpt-5.5','gpt-image-2.5']) {
      await page.goto((process.env.REIZO_TEST_URL || 'https://reizo-ai.com')+'/studio?model='+model+'&entry=model-catalog');
      await page.waitForTimeout(2000);
      const text = await page.locator('body').innerText();
      if(text.includes('会话不存在或无权访问') || text.includes('gpt-4o-mini') || !text.includes(model)) throw new Error('FAIL: catalog entry restored stale session or lost model: '+model+' '+text.slice(-700));
      if(model==='gpt-image-2.5' && !(await page.locator('.composer-mode-trigger:visible').first().innerText()).includes('图片')) throw new Error('Image model did not select image mode');
    }
    console.log('PASS: repeated model entry preserves selection; image model selects image mode');
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
