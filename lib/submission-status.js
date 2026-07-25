import {
  canExplicitlyTransitionSubmission,
  isSubmissionStatus,
  normalizeSubmissionStatus,
  resolveSubmissionTypeConfig,
} from './submission-workflow.js';

async function defaultRequireAdminMfa() {
  const mod = await import('./auth-helpers.js');
  return mod.requireAdminMfa();
}

async function defaultCreateAdminClient() {
  const mod = await import('./supabase/admin.js');
  return mod.createAdminClient();
}

export async function updateSubmissionStatusRecord({ type, id, nextStatus, deps = {} }) {
  const auth = deps.requireAdminMfa || defaultRequireAdminMfa;
  const admin = deps.createAdminClient || defaultCreateAdminClient;

  const { unauthorized, reason } = await auth();
  if (unauthorized) {
    return { status: 401, body: { error: 'Unauthorized', reason } };
  }

  const config = resolveSubmissionTypeConfig(type);
  if (!config) {
    return { status: 404, body: { error: 'Unknown submission type.' } };
  }

  if (!id) {
    return { status: 400, body: { error: 'Missing id.' } };
  }

  if (!isSubmissionStatus(nextStatus)) {
    return { status: 400, body: { error: 'Invalid status.' } };
  }

  const supabase = await admin();
  const { data: current, error: fetchError } = await supabase
    .from(config.table)
    .select('id, status')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    return { status: 400, body: { error: fetchError.message } };
  }

  if (!current) {
    return { status: 404, body: { error: 'Submission not found.' } };
  }

  const currentStatus = normalizeSubmissionStatus(current.status);
  const targetStatus = normalizeSubmissionStatus(nextStatus);

  if (!canExplicitlyTransitionSubmission(currentStatus, targetStatus)) {
    return {
      status: 400,
      body: { error: `Cannot transition ${currentStatus} to ${targetStatus}.` },
    };
  }

  if (currentStatus === targetStatus) {
    return {
      status: 200,
      body: {
        ok: true,
        changed: false,
        type,
        id,
        previousStatus: currentStatus,
        status: targetStatus,
      },
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from(config.table)
    .update({ status: targetStatus })
    .eq('id', id)
    .select('id, status')
    .single();

  if (updateError) {
    return { status: 400, body: { error: updateError.message } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      changed: true,
      type,
      id,
      previousStatus: currentStatus,
      status: normalizeSubmissionStatus(updated?.status),
    },
  };
}
