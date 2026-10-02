// Isolated UI fixture: real TicketEventGrid and GuestTicketControl, fake wallet.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TicketEventGrid from '../../components/account/TicketEventGrid';

const ticketId='00000000-0000-4000-8000-000000000050';
let current={id:ticketId,ticket_code:'DEMO-NOT-A-REAL-TICKET',status:'valid',reserved_for_guest:false};
window.guestFixture={mode:'success',writes:0};
const qr='<svg width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="white"/><text x="90" y="80" fill="black" text-anchor="middle" font-size="16">TEST TICKET</text><text x="90" y="105" fill="black" text-anchor="middle" font-size="12">not valid for entry</text></svg>';
window.fetch=async(path,init)=>{
  window.guestFixture.writes++;
  const body=JSON.parse(init.body);
  await new Promise(resolve=>setTimeout(resolve,350));
  if(window.guestFixture.mode==='error') return new Response(JSON.stringify({error:'Could not confirm the change. Refresh your tickets before sharing.'}),{status:503});
  if(current.status!=='valid') return new Response(JSON.stringify({error:'This ticket is no longer available to change. Refresh your tickets.'}),{status:409});
  current={...current,reserved_for_guest:body.reserved_for_guest};
  return new Response(JSON.stringify({ticket:current}),{status:200});
};
function Fixture(){
  const [ticket,setTicket]=useState(current);
  useEffect(()=>{
    const refresh=()=>setTicket({...current});
    window.addEventListener('fixture-refresh',refresh);
    window.guestFixture.use=()=>{current={...current,status:'used'};refresh();};
    return()=>window.removeEventListener('fixture-refresh',refresh);
  },[]);
  return <main><h1>Ticket details</h1><p>Isolated UI test. No live account or ticket.</p>
    <TicketEventGrid initialNow="2026-10-01T12:00:00Z" orders={[{
      id:'order',event_id:'event',status:'paid',currency:'USD',total_cents:3000,
      event:{title:'Stardust test event',event_date:'2026-10-10',event_time:'10PM'},
      items:[],tickets:[{...ticket,_qrSvg:qr}],
    }]}/></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
