const {chromium}=require('/opt/visual/node_modules/playwright');
const fs=require('node:fs');
(async()=>{
 const url=process.env.ORBITA_URL||'http://horizon-orbita-painel:3000';
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const result={tests:[],screens:[],errors:[]};
 for(const [name,width,height] of [['android-modern',393,852],['android-compact',360,800],['desktop',1440,960]]){
  const context=await browser.newContext({viewport:{width,height}});
  const page=await context.newPage();
  page.on('pageerror',error=>result.errors.push(name+': '+error.message));
  await page.goto(url+'/central/',{waitUntil:'domcontentloaded'});
  await page.locator('#mode-estudio').click();
  await page.locator('#wf-root').waitFor({state:'visible',timeout:12000});
  result.tests.push(name+' studio loaded');
  await page.locator('#wf-new').click();
  result.tests.push(name+' new project');
  const before=await page.locator('#wf-pages button').count();
  await page.locator('#wf-add-page').click();
  const after=await page.locator('#wf-pages button').count();
  if(after!==before+1)throw Error('Page creation failed in '+name);
  await page.locator('#wf-tools [data-add="button"]').click();
  if(await page.locator('#wf-canvas [data-el]').count()!==1)throw Error('Wireframe button missing in '+name);
  await page.locator('#studio-tab-code').click();
  await page.locator('#studio-root').waitFor({state:'visible'});
  await page.locator('#studio-tab-wireframe').click();
  await page.screenshot({path:'/evidence/orbita-'+name+'.png',fullPage:true,animations:'disabled'});
  result.screens.push('orbita-'+name+'.png');
  const state=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,
   tab:document.querySelector('#mode-estudio').classList.contains('active'),
   title:document.title}));
  if(state.overflow>1)throw Error('Horizontal overflow '+name+' '+state.overflow);
  if(!state.tab)throw Error('Studio mode not active '+name);
  result.tests.push(name+' responsive and mode switching');
  await context.close();
 }
 await browser.close();
 console.log(JSON.stringify(result));
 if(result.errors.length)process.exitCode=1;
})().catch(err=>{console.log(JSON.stringify({error:err.message}));process.exitCode=1});
