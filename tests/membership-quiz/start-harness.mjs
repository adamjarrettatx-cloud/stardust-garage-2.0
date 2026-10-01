import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { validateQuiz, quizRecommendation, PLAN_SLUGS } from '../../lib/membership-quiz.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out='/tmp/sdg-membership-quiz-qa';
await mkdir(out,{recursive:true});
await build({
  absWorkingDir:root,entryPoints:['tests/membership-quiz/harness.jsx'],outdir:out,bundle:true,format:'esm',jsx:'automatic',loader:{'.js':'jsx'},
  alias:{'@':root},
  plugins:[{name:'next-qa-fixtures',setup(b){
    b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'qa'}));
    b.onLoad({filter:/.*/,namespace:'qa'},a=>({loader:'jsx',resolveDir:root,contents:a.path==='next/link'
      ? `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}`
      : `export function useRouter(){return{refresh(){},push(url){location.assign(url)}}}`}));
  }}],
});
const rows=new Map();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost:3003');
  const user=req.headers['x-qa-account'];
  if(url.pathname==='/__qa/result')return json(res,200,rows.get(user)||null);
  if(url.pathname==='/api/members/quiz'){
    if(!user)return json(res,401,{error:'Sign in required'});
    let raw='';for await(const c of req)raw+=c;
    try{
      const body=JSON.parse(raw),answers=validateQuiz(body.answers),recommendation=quizRecommendation(answers);
      const selectedPlan=body.selectedPlan||recommendation.primary;
      if(!Object.hasOwn(PLAN_SLUGS,selectedPlan))throw Error('Invalid plan');
      rows.set(user,{answers,selected_plan:PLAN_SLUGS[selectedPlan]});
      return json(res,200,{recommendation,selectedPlan,next:`/members/apply/${PLAN_SLUGS[selectedPlan]}`});
    }catch(e){return json(res,400,{error:e.message});}
  }
  if(url.pathname.startsWith('/members/apply/')){
    res.writeHead(200,{'Content-Type':'text/html'});return res.end(`<h1>Application handoff fixture</h1><p>${url.pathname.split('/').pop()}</p><p>No real application is submitted by this test harness.</p>`);
  }
  if(url.pathname.startsWith('/logos/')){
    try{res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end(await readFile(path.join(root,'public',url.pathname)));}catch{res.writeHead(404);return res.end();}
  }
  if(['/harness.js','/harness.css'].includes(url.pathname)){
    res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'});
    return res.end(await readFile(path.join(out,url.pathname)));
  }
  res.writeHead(200,{'Content-Type':'text/html'});
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"><style>body{margin:0}button,input{font:inherit}a{text-decoration:none}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>');
}).listen(3003,'0.0.0.0',()=>console.log('Isolated membership QA at :3003. No real accounts or production writes.'));
