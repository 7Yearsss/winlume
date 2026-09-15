// Isolated browser verification: real directory/admin components and styles;
// only Next routing, authentication and API storage are replaced with local fixtures.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const esbuild = require('esbuild');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'application-directory-qa');
fs.mkdirSync(output, { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  await esbuild.build({ entryPoints: [path.join(root, 'src/lib/portal/application-tools.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(output, 'catalog.cjs') });
  const catalog = require(path.join(output, 'catalog.cjs'));
  let content = { carousel: [], notifications: [], modelVendors: [], applicationShowcase: [], capabilityShowcase: [], toolDirectory: catalog.defaultToolPresentation };
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Directory from './src/components/ApplicationDirectory'; import Admin from './src/components/account/PortalContentAdminContent'; const admin=location.pathname.startsWith('/admin'); createRoot(document.getElementById('root')).render(admin ? <Admin initialSection="tools" /> : <div className="portal-home"><div className="qa-frame"><Directory initialCategory={new URLSearchParams(location.search).get('category') ?? undefined} /></div></div>);`, resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, outfile: path.join(output, 'app.js'), jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [{ name: 'local-boundaries', setup(build) {
      build.onResolve({ filter: /^(next\/(link|image|navigation)|@\/components\/providers)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'jsx', resolveDir: root, contents:
        args.path === 'next/link' ? `import React from 'react'; export default function Link({children,...props}){return <a {...props}>{children}</a>}` :
        args.path === 'next/image' ? `import React from 'react'; export default function Image({fill,unoptimized,sizes,style,...props}){return <img {...props} style={{...(fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}),...style}}/>}` :
        args.path === 'next/navigation' ? `export const useRouter=()=>({replace:(url)=>history.replaceState(null,'',url),push:(url)=>location.assign(url),refresh:()=>{}}); export const usePathname=()=>location.pathname;` :
        `export const useModals=()=>({account:{id:'qa-admin',platform_role:'admin'},accountLoading:false});`
      }));
    } }],
  });
  const css = await postcss([require('@tailwindcss/postcss')({ base: root })]).process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  const files = new Map(bundle.outputFiles.map(file => [path.basename(file.path), file.contents]));
  files.set('global.css', css.css);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/skills') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ skills: Array.from({length:6}, (_,i)=>({id:`skill-${i}`,name:['品牌文案创作','SEO 文章优化','社媒内容策划','公众号文案创作','内容选题助手','营销邮件撰写'][i],description:'整理品牌表达、创作结构与执行要点，将专业能力挂到工作台继续使用。',category:'marketing',examplePrompt:'请协助完成内容创作'})), catalogs: [{id:'content-marketing',count:6}] }));
    }
    if (url.pathname === '/api/portal/content' || url.pathname === '/api/admin/portal-content') {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'PUT') {
        let body=''; req.on('data', chunk=>body+=chunk); req.on('end',()=>{const patch=JSON.parse(body); assert.equal(patch.section,'toolDirectory'); content={...content,toolDirectory:catalog.normalizeToolPresentation(patch.value)}; res.end(JSON.stringify(content));}); return;
      }
      return res.end(JSON.stringify(content));
    }
    const name = url.pathname.slice(1);
    if (files.has(name)) {res.setHeader('Content-Type', name.endsWith('.css')?'text/css':'application/javascript');return res.end(files.get(name));}
    if (url.pathname.startsWith('/tool-covers/')) {
      const image = path.join(root, 'public/tool-covers', path.basename(url.pathname));
      if(fs.existsSync(image)){res.setHeader('Content-Type','image/webp');return fs.createReadStream(image).pipe(res);}
      res.statusCode=404;return res.end();
    }
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>body{margin:0}.qa-frame{max-width:1660px;margin:auto;padding:28px}.portal-home{min-height:100vh;background:linear-gradient(120deg,#e7f0ff,#f7faff)}@media(max-width:760px){.portal-home{min-width:0}.qa-frame{padding:14px}}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const failures=[];
  try {
    const page=await browser.newPage({viewport:{width:1660,height:1100}});
    page.on('pageerror',error=>failures.push(error.message));
    await page.goto(base+'/?category='+encodeURIComponent('内容与营销'));
    await page.getByRole('link',{name:'立即使用文案助手',exact:true}).waitFor();
    assert.equal(await page.locator('a[aria-label^="立即使用"]').count(),3);
    await page.waitForFunction(()=>[...document.querySelectorAll('a[aria-label^="立即使用"] img')].every(img=>img.complete&&img.naturalWidth>0));
    await page.screenshot({path:path.join(output,'category-desktop.png'),fullPage:true});
    await page.getByRole('button',{name:/视觉与媒体/}).click();
    assert.equal(await page.locator('a[aria-label^="立即使用"]').count(),3);
    await page.getByRole('button',{name:'更多工具',exact:true}).click();
    const dialog=page.getByRole('dialog'); await dialog.waitFor();
    assert.equal(await dialog.locator('a[aria-label^="立即使用"]').count(),4);
    await page.getByRole('textbox',{name:'搜索更多工具'}).fill('剪辑');
    assert.equal(await dialog.locator('a[aria-label^="立即使用"]').count(),1);
    const popupPromise=page.waitForEvent('popup'); await dialog.getByRole('link',{name:'立即使用视频剪辑助手'}).click();
    const popup=await popupPromise; await popup.waitForLoadState('domcontentloaded');
    assert.equal(new URL(popup.url()).searchParams.get('tool'),'视频剪辑助手'); await popup.close();
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
    await page.getByRole('textbox',{name:'搜索应用'}).fill('剪辑');
    assert.equal(await page.locator('a[aria-label^="立即使用"]').count(),1);
    await page.getByRole('button',{name:'清除搜索'}).click();
    await page.getByRole('button',{name:'全部应用',exact:true}).click();
    assert.equal(await page.locator('a[aria-label^="立即使用"]').count(),24);
    await page.getByRole('button',{name:/内容与营销/}).click();
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'category-mobile.png'),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
    assert.equal(overflow,false,'Isolated mobile component must not overflow');
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(base+'/admin');
    await page.getByRole('button',{name:'保存工具目录'}).waitFor();
    const first=page.locator('article').filter({has:page.getByRole('heading',{name:'文案助手',exact:true})});
    await first.getByRole('textbox').fill('/tool-covers/seo.webp');
    const saved=page.waitForResponse(r=>r.request().method()==='PUT'); await page.getByRole('button',{name:'保存工具目录'}).click();await saved;
    await page.reload(); await page.getByRole('button',{name:'保存工具目录'}).waitFor();
    assert.equal(await first.getByRole('textbox').inputValue(),'/tool-covers/seo.webp');
    await page.screenshot({path:path.join(output,'admin.png'),fullPage:true});
    await page.goto(base+'/?category='+encodeURIComponent('内容与营销'));
    await page.waitForFunction(()=>document.querySelector('a[aria-label="立即使用文案助手"] img')?.getAttribute('src')==='/tool-covers/seo.webp');
    assert.deepEqual(failures,[]);
    console.log('PASS: 3 representatives per category, 24 across all categories, more-tools search, new-tab entry, hidden-tool search, mobile overflow, admin save/reload/public cover update.');
  } finally {await browser.close(); await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
