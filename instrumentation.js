export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VIEW_PORTAL_MODE === 'sandbox') {
    const { installSandboxEgressGuard } = await import('./lib/view-portal/egress');
    installSandboxEgressGuard();
  }
}
