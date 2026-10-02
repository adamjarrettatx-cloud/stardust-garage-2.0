// Run after start-harness.mjs. Uses only the isolated fake wallet.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:3117');
  await page.getByRole('button',{name:/Stardust test event/}).click();
  await page.getByRole('button',{name:'For a guest',exact:true}).click();
  await page.getByText('Saved for your guest. You can now screenshot this ticket.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.guestFixture.writes),1);
  assert.ok(await page.getByText(/They must also show their own valid My Pass/).isVisible());
  const bounds=await page.locator('dialog').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));
  assert.ok(bounds.scroll<=bounds.client+1,'ticket dialog must not horizontally overflow on phone');
  await page.screenshot({path:'/home/user/workspace/guest-ticket-phone-qa.png',fullPage:true});
  let dialogText='';
  page.once('dialog',async d=>{dialogText=d.message();await d.dismiss();});
  await page.getByRole('button',{name:'Use for myself',exact:true}).click();
  assert.match(dialogText,/already sent its screenshot/);
  assert.equal(await page.evaluate(()=>window.guestFixture.writes),1,'cancel must not write');
  page.once('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Use for myself',exact:true}).click();
  await page.getByText('Saved for your own pass check-in.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.guestFixture.mode='error';});
  await page.getByRole('button',{name:'For a guest',exact:true}).click();
  await page.getByText('Could not confirm the change. Refresh your tickets before sharing.',{exact:true}).waitFor();
  assert.equal(await page.getByText('Saved for your guest. You can now screenshot this ticket.',{exact:true}).count(),0);
  await page.evaluate(()=>window.guestFixture.use());
  await page.getByText('This ticket is no longer available for entry or guest changes.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'For a guest',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: real web components at 390px; save, screenshot instructions, undo warning/cancel, failed save, used-ticket lockout, no overflow or JS errors.');
}finally{await browser.close();}
