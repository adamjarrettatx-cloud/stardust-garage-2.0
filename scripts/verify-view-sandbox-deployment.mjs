// Deployment-only branch: do not merge this hosting configuration into main.
import assert from 'node:assert/strict';

export function verifySandboxDeployment(env) {
  assert.equal(env.VIEW_PORTAL_MODE, 'sandbox', 'This deployment branch is sandbox-only');
  assert.equal(
    env.NEXT_PUBLIC_SUPABASE_URL,
    'https://ygcqwohfnijjaeoobwhj.supabase.co',
    'Only the approved isolated database is permitted',
  );
  const forbidden = Object.keys(env).filter((name) =>
    /^(STRIPE|RESEND|MERCURY|MAILCHIMP|TWILIO|TICKETTAILOR|TICKET_TAILOR|AUTHORIZE|SIGNNOW|EXPO_ACCESS_TOKEN|CRON_SECRET)/.test(name)
    && env[name],
  );
  assert.equal(forbidden.length, 0, 'Remove external integration credentials');
}

if (process.argv[1]?.endsWith('/verify-view-sandbox-deployment.mjs')) {
  verifySandboxDeployment(process.env);
  console.log('Sandbox deployment target and integration exclusions verified.');
}
