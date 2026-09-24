import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { w9Access,W9_HEADERS } from '@/lib/w9/server';
export const runtime='nodejs';
export async function GET(request){
  const a=await w9Access(request);if(a.response)return a.response;
  const pdf=await readFile(path.join(process.cwd(),'lib/w9/assets/fw9.pdf'));
  return new Response(pdf,{headers:{...W9_HEADERS,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="Form-W9.pdf"','X-Content-Type-Options':'nosniff'}});
}
