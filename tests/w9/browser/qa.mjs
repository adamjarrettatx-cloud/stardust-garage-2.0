// Isolated browser QA: runs the real client components with mocked APIs.
// No production environment variables or authentication are used.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=process.env.W9_QA_OUTPUT || '/home/user/workspace/w9-qa';
await mkdir(output,{recursive:true});
const server=await createServer({configFile:new URL('./vite.config.mjs',import.meta.url).pathname});
await server.listen();
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let submissions=[],canReview=true,forceSubmitError=false,submitCount=0;
const reviewedAt='2026-09-24T16:00:00Z';
await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const json=body=>route.fulfill({json:body});
  if(url.pathname.endsWith('/open'))return json({ok:true});
  if(url.pathname==='/api/portal/w9'){
    if(request.method()==='POST'){
      if(forceSubmitError)return route.fulfill({status:503,json:{error:'Test: please retry.'}});
      const body=request.postDataJSON();
      submitCount++;
      submissions.unshift({id:body.id,document_id:body.id,status:'pending',created_at:reviewedAt});
      return json({ok:true});
    }
    return json({submissions});
  }
  if(url.pathname.endsWith('/tax-profile'))return json({enabled:true,canReview,status:submissions.some(s=>s.status==='approved')?'approved':submissions[0]?.status||'missing',submissions:canReview?submissions:[]});
  if(url.pathname.endsWith('/review')){
    const body=request.postDataJSON(),id=url.pathname.split('/').at(-2);
    Object.assign(submissions.find(s=>s.id===id),{status:body.decision,rejection_reason:body.decision==='denied'?body.reason:null,reviewed_at:reviewedAt});
    return json({ok:true});
  }
  if(url.pathname.endsWith('/download')||url.pathname.endsWith('/blank')||url.pathname.endsWith('/document')){
    return route.fulfill({contentType:'application/pdf',body:await readFile(new URL('../../../lib/w9/assets/fw9.pdf',import.meta.url))});
  }
  return route.fulfill({status:404,json:{error:'Unmocked endpoint'}});
});
async function fit(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'horizontal overflow')}
async function shot(name){await fit();await page.screenshot({path:`${output}/${name}.png`})}
async function form(){
  await page.getByRole('button',{name:'Fill out w9',exact:true}).click();
  await page.locator('input[name="legalName"]').fill('TEST ARTIST ONLY');
  await page.getByLabel('3a · Federal tax classification').selectOption('llc');
  await page.getByLabel('LLC tax classification').selectOption('P');
  await page.getByLabel('3a · Federal tax classification').selectOption('individual');
  assert.equal(await page.getByLabel('LLC tax classification').count(),0);
  await page.locator('input[name="address"]').fill('123 Example Street');
  await page.locator('input[name="cityStateZip"]').fill('Austin, TX 78701');
  await page.locator('input[type="password"]').fill('123456789');
  await page.getByLabel(/By typing my name and clicking Submit/).check();
  await page.locator('input[name="signature"]').fill('TEST ARTIST ONLY');
}
try {
  await page.goto('http://127.0.0.1:3011');
  await page.getByRole('button',{name:'Fill out w9',exact:true}).waitFor();
  await shot('artist-desktop');
  await form();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await form();await shot('form-desktop');
  await page.locator('input[name="legalName"]').scrollIntoViewIfNeeded();await shot('form-top-desktop');
  forceSubmitError=true;
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await page.getByText('Test: please retry.').waitFor();
  forceSubmitError=false;
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  await page.getByText('Pending review',{exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'Fill out w9',exact:true}).count(),0);
  await shot('pending-desktop');
  await page.goto('http://127.0.0.1:3011/?reviewer');
  await page.getByRole('button',{name:'Review W-9',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Approve W-9',exact:true}).isDisabled(),true);
  await page.getByLabel('I have reviewed this signed W-9.').check();
  assert.equal(await page.getByRole('button',{name:'Deny and request a new W-9'}).isDisabled(),true);
  await page.getByLabel('Comment required for denial').fill('Please correct your legal name on line 1.');
  await page.getByRole('button',{name:'Deny and request a new W-9'}).click();
  await page.getByText('Needs a new W-9',{exact:true}).first().waitFor();
  await shot('denied-review-desktop');
  await page.goto('http://127.0.0.1:3011');
  await page.getByText('Please submit a new W-9',{exact:true}).waitFor();
  await shot('artist-denied-desktop');
  await form();
  await page.getByRole('button',{name:'Submit',exact:true}).click();
  assert.equal(submitCount,2);
  assert.notEqual(submissions[0].id,submissions[1].id);
  await page.goto('http://127.0.0.1:3011/?reviewer');
  await page.getByRole('button',{name:'Review W-9',exact:true}).first().click();
  await page.getByLabel('I have reviewed this signed W-9.').check();
  await page.getByRole('button',{name:'Approve W-9',exact:true}).click();
  await page.getByText('Approved',{exact:true}).first().waitFor();
  await shot('approved-review-desktop');
  await page.setViewportSize({width:375,height:812});await shot('approved-review-mobile');
  await page.goto('http://127.0.0.1:3011');
  await page.getByText('Ready to book',{exact:true}).waitFor();
  await shot('artist-approved-mobile');
  await page.goto('http://127.0.0.1:3011/?reviewer');
  canReview=false;await page.reload();
  await page.getByText('Tax documents and review actions are restricted to Adam, Jeyu, and Naish.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Review W-9',exact:true}).count(),0);
  await shot('staff-readiness-mobile');
  submissions=[];await page.goto('http://127.0.0.1:3011');
  await shot('artist-mobile');await form();await shot('form-mobile');
  await page.locator('input[name="legalName"]').scrollIntoViewIfNeeded();await shot('form-top-mobile');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.addStyleTag({content:':root{--auth-card-bg:#161616;--auth-card-bg-alt:#232323;--auth-text:#ededed;--auth-muted:#aaa;--auth-card-border:#444;--auth-card-border-strong:#666;--auth-input-bg:#202020;--auth-input-text:#eee;--auth-input-border:#666}body{background:#0d0d0d;color:#eee}'});
  await shot('artist-dark-mobile');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,submitCount,screenshots:output,consoleErrors:errors}));
} finally {await browser.close();await server.close()}
