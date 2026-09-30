import { afterEach, expect, it, vi } from 'vitest';
import { adminFetch } from '@/lib/admin-fetch';
afterEach(()=>vi.unstubAllGlobals());
it('preserves the admin workspace when an API requires step-up without retaining form secrets', async()=>{
  vi.stubGlobal('window',{location:{pathname:'/bananas/team',search:'',href:''}});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({reason:'mfa_required'}),{status:401})));
  await expect(adminFetch('/api/admin/stations',{method:'POST',body:'not-in-redirect'})).rejects.toThrow('authentication required');
  expect(window.location.href).toBe('/bananas/security?mfa=required&next=%2Fbananas%2Fteam');
});
it('does not redirect for success or unrelated authorization failure',async()=>{
  vi.stubGlobal('window',{location:{pathname:'/bananas/team',search:'',href:'unchanged'}});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({stations:[]}))));
  expect(await adminFetch('/api/admin/stations')).toEqual({stations:[]});
  expect(window.location.href).toBe('unchanged');
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({error:'Unauthorized'}),{status:401}));
  await expect(adminFetch('/api/admin/stations')).rejects.toThrow('Unauthorized');
  expect(window.location.href).toBe('unchanged');
});
