import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:vi.fn(()=>({}))}));
vi.mock('@/lib/feature-flags',()=>({isInternalTicketingEnabled:()=>true}));
vi.mock('@/lib/events/door-events-server',()=>({
  loadDoorEvents:vi.fn(),
  DOOR_CACHE_HEADERS:{'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Vercel-CDN-Cache-Control':'no-store'},
}));
import {loadDoorEvents} from '@/lib/events/door-events-server';
import {GET} from '@/app/api/door-events/route';
beforeEach(()=>vi.clearAllMocks());
it('is public, uncached and cannot accept event/time/preview overrides',async()=>{
  loadDoorEvents.mockResolvedValue({state:'empty',events:[],server_now:'2026-10-01T22:00:00Z'});
  const response=await GET(new Request('https://sdgatx.com/api/door-events?now=2099&event_id=private&preview=1'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe('no-store');
  expect(loadDoorEvents).toHaveBeenCalledWith({}, {ticketingEnabled:true});
  expect((await response.json()).events).toEqual([]);
});
it('fails closed without exposing database errors or credentials',async()=>{
  loadDoorEvents.mockRejectedValue(new Error('SECRET database detail'));
  const response=await GET();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('SECRET');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
});
