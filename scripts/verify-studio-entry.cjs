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
      if(path==='/api/capabilities') body={models:['gpt-6-astra','gpt-5.5','gpt-image-2.5'],capabilities:[{id:'chat',availability:'available'},{id:'image.generate',availability:'available'}]};
      await route.fulfill({json:body});
    });
    for (const model of ['gpt-6-astra','gpt-5.5','gpt-image-2.5']) {
      await page.goto((process.env.REIZO_TEST_URL || 'https://reizo-ai.com')+'/studio?model='+model+'&entry=model-catalog');
      await page.waitForTimeout(2000);
      const text = await page.locator('body').innerText();
      if(text.includes('会话不存在或无权访问') || text.includes('gpt-4o-mini') || !text.includes(model)) throw new Error('FAIL: catalog entry restored stale session or lost model: '+model+' '+text.slice(-700));
      if(model==='gpt-image-2.5' && !(await page.locator('.composer-mode-trigger:visible').first().innerText()).includes('图片')) throw new Error('Image model did not select image mode');
    }
    await page.setViewportSize({width:1280,height:600});
    await page.locator('.composer-mode-trigger:visible').first().click();
    await page.waitForTimeout(300);
    const modeBox=await page.locator('[data-slot="select-content"]:visible').boundingBox();
    if(!modeBox || modeBox.y<0 || modeBox.y+modeBox.height>600) throw new Error('Mode menu exceeds laptop viewport');
    await page.keyboard.press('Escape');
    await page.locator('.composer-selected-model:visible').first().click();
    await page.getByRole('textbox',{name:'搜索模型或提供商'}).fill('gpt-image-2.5');
    await page.waitForTimeout(300);
    const pickerBox=await page.locator('.composer-settings-popover:visible').boundingBox();
    if(!pickerBox || pickerBox.x<0 || pickerBox.y<0 || pickerBox.x+pickerBox.width>1280 || pickerBox.y+pickerBox.height>600) throw new Error('Model picker exceeds laptop viewport');
    await page.locator('.composer-model-search-results button').filter({hasText:'gpt-image-2.5'}).click();
    console.log('PASS: laptop menu bounds and model search selection');
    console.log('PASS: repeated model entry preserves selection; image model selects image mode');
  } finally {await browser.close();}
})().catch(e=>{console.error(e.message);process.exit(1)});
