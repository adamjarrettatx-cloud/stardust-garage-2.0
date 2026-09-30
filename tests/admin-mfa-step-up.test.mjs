import test from 'node:test';
import assert from 'node:assert/strict';
import { adminMfaReturnTo, verifyAdminSecondFactor } from '../lib/admin-mfa-step-up.js';

test('MFA return destination only permits local non-security admin workspaces', () => {
  assert.equal(adminMfaReturnTo('/bananas/team'), '/bananas/team');
  assert.equal(adminMfaReturnTo('/bananas/events?tab=calendar'), '/bananas/events?tab=calendar');
  for (const next of ['https://evil.test','//evil.test','/bananas-other','/bananas/../portal','/bananas/security','/bananas/login','/bananas\\evil',null,{}]) {
    assert.equal(adminMfaReturnTo(next), '/bananas');
  }
});
test('existing-factor verification challenges and verifies a six-digit code then requires aal2', async () => {
  const calls=[];
  const supabase={auth:{mfa:{
    challenge:async args=>{calls.push(['challenge',args]);return {data:{id:'challenge'}}},
    verify:async args=>{calls.push(['verify',args]);return {data:{}}},
    getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'}}),
  }}};
  await verifyAdminSecondFactor(supabase,'factor','012345');
  assert.deepEqual(calls,[['challenge',{factorId:'factor'}],['verify',{factorId:'factor',challengeId:'challenge',code:'012345'}]]);
  supabase.auth.mfa.getAuthenticatorAssuranceLevel=async()=>({data:{currentLevel:'aal1'}});
  await assert.rejects(verifyAdminSecondFactor(supabase,'factor','012345'),/could not be verified/);
});
test('invalid input and provider failures never report successful step-up', async () => {
  for(const code of ['', '12345', '1234567','abcdef']) {
    await assert.rejects(verifyAdminSecondFactor({},'factor',code),/6-digit/);
  }
  await assert.rejects(verifyAdminSecondFactor({},null,'123456'),/6-digit/);
  const mfa={
    challenge:async()=>({error:{message:'private'}}),
    verify:async()=>({error:{message:'private'}}),
    getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2'}}),
  };
  await assert.rejects(verifyAdminSecondFactor({auth:{mfa}},'factor','123456'),/Could not start/);
  mfa.challenge=async()=>({data:{id:'challenge'}});
  await assert.rejects(verifyAdminSecondFactor({auth:{mfa}},'factor','123456'),/Code not accepted/);
  mfa.verify=async()=>({});
  mfa.getAuthenticatorAssuranceLevel=async()=>({error:{message:'private'}});
  await assert.rejects(verifyAdminSecondFactor({auth:{mfa}},'factor','123456'),/could not be verified/);
});
