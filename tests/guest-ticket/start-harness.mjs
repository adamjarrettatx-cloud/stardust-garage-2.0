import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
const root=process.cwd(),dir=root+'/.guest-ticket-qa';
await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/guest-ticket/browser.fixture.jsx'],bundle:true,outfile:dir+'/app.js',
  platform:'browser',jsx:'automatic',alias:{'@':root,'next/navigation':root+'/tests/guest-ticket/navigation.fixture.jsx','next/link':root+'/tests/guest-ticket/navigation.fixture.jsx'}});
const css=await readFile(root+'/app/account/account.css','utf8');
await writeFile(dir+'/index.html',`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}
body{margin:0;background:#0a0a0a;color:#f5f5f5;font:15px/1.5 system-ui}main{max-width:680px;margin:auto;padding:20px}button{cursor:pointer}dialog{background:#141414;color:#f5f5f5;width:calc(100% - 48px);max-width:580px;max-height:85vh;border:1px solid #444;border-radius:16px;padding:16px}dialog::backdrop{background:#000b}button,a{color:inherit}button{background:transparent;border:1px solid #666;border-radius:8px;min-height:44px;padding:8px 12px}.account-hub-note{color:#bbb}.ticket-detail-body{text-align:center}.ticket-detail-body>div{box-sizing:border-box}summary{padding:12px;cursor:pointer}.ticket-detail-code{overflow-wrap:anywhere}.account-hub-panel-heading{display:flex;justify-content:space-between;gap:10px}h2{font-size:22px}button:disabled{opacity:.5}
</style></head><body class="account-hub"><div id="root"></div><script src="/app.js"></script></body></html>`);
createServer(async(req,res)=>{try{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(await readFile(dir+(req.url==='/app.js'?'/app.js':'/index.html')));}catch{res.statusCode=500;res.end('Fixture unavailable');}}).listen(3117,'0.0.0.0');
