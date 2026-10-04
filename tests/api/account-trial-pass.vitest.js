import { beforeEach, expect, it } from 'vitest';
import { getAccountTrialPassCredential, linkTrialPassByVerifiedEmail } from '../../lib/account-trial-pass.js';
import { openPassToken, sealPassToken } from '../../lib/trial-pass-seal.mjs';
import { generatePassToken, hashPassToken } from '../../lib/trial-pass.js';

const SECRET = 'test-secret-that-is-long-enough-for-sealing';
process.env.TRIAL_PASS_QR_SEAL_SECRET = SECRET;

let rows, writes;
function admin() {
  return {
    from() {
      const q = { filters: [], op: 'select' };
      const chain = {
        select() { return chain; },
        update(patch) { q.op = 'update'; q.patch = patch; return chain; },
        eq(k, v) { q.filters.push(['eq', k, v]); return chain; },
        is(k, v) { q.filters.push(['is', k, v]); return chain; },
        order() { return chain; }, limit() { return chain; },
        maybeSingle() { q.single = true; return chain; },
        then(resolve) {
          const match = (r) => q.filters.every(([op, k, v]) => (op === 'is' ? r[k] === v : r[k] === v));
          const hits = rows.filter(match);
          if (q.op === 'update') { hits.forEach((r) => Object.assign(r, q.patch)); writes.push(q); }
          const data = q.single ? hits[0] || null : hits.map((r) => ({ ...r }));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
}
const live = { status: 'active', issued_at: '2026-10-01T00:00:00Z', signup_expires_at: '2099-01-01T00:00:00Z', expires_at: null, activated_at: null };

beforeEach(() => { rows = []; writes = []; });

it('seal round-trips and rejects tampering or the wrong key', () => {
  const token = generatePassToken();
  const sealed = sealPassToken(token, SECRET);
  expect(openPassToken(sealed, SECRET)).toBe(token);
  expect(openPassToken(sealed, 'a-different-secret-of-sufficient-length')).toBeNull();
  expect(openPassToken(`${sealed.slice(0, -2)}AA`, SECRET)).toBeNull();
});

it('returns the existing token when the seal matches, without rotating', async () => {
  const token = generatePassToken();
  rows.push({ id: 'p1', user_id: 'u1', ...live, qr_token_hash: hashPassToken(token), qr_token_sealed: sealPassToken(token, SECRET) });
  const result = await getAccountTrialPassCredential({ admin: admin(), userId: 'u1' });
  expect(result.token).toBe(token);
  expect(writes).toHaveLength(0);
});

it('re-mints a legacy unsealed pass once, then stays stable', async () => {
  rows.push({ id: 'p1', user_id: 'u1', ...live, qr_token_hash: 'legacy-hash', qr_token_sealed: null });
  const first = await getAccountTrialPassCredential({ admin: admin(), userId: 'u1' });
  expect(hashPassToken(first.token)).toBe(rows[0].qr_token_hash);
  const second = await getAccountTrialPassCredential({ admin: admin(), userId: 'u1' });
  expect(second.token).toBe(first.token);
  expect(writes).toHaveLength(1);
});

it('never reads another account and ignores expired passes', async () => {
  const token = generatePassToken();
  rows.push({ id: 'p1', user_id: 'someone-else', ...live, qr_token_hash: hashPassToken(token), qr_token_sealed: sealPassToken(token, SECRET) });
  rows.push({ id: 'p2', user_id: 'u1', ...live, status: 'expired', qr_token_hash: 'x', qr_token_sealed: null });
  expect((await getAccountTrialPassCredential({ admin: admin(), userId: 'u1' })).pass).toBeNull();
});

it('links by confirmed email only, and never steals a linked pass', async () => {
  rows.push({ id: 'p1', user_id: null, email_canonical: 'guest@gmail.com' });
  rows.push({ id: 'p2', user_id: 'other', email_canonical: 'taken@example.com' });
  await linkTrialPassByVerifiedEmail({ admin: admin(), user: { id: 'u1', email: 'Gue.st+x@gmail.com', email_confirmed_at: null } });
  expect(rows[0].user_id).toBeNull();
  await linkTrialPassByVerifiedEmail({ admin: admin(), user: { id: 'u1', email: 'Gue.st+x@gmail.com', email_confirmed_at: '2026-10-01' } });
  expect(rows[0].user_id).toBe('u1');
  await linkTrialPassByVerifiedEmail({ admin: admin(), user: { id: 'u1', email: 'taken@example.com', email_confirmed_at: '2026-10-01' } });
  expect(rows[1].user_id).toBe('other');
});
