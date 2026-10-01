import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { validateMembershipApplication } from '@/lib/membership-application';
import { QUIZ_VERSION, validateQuiz, quizRecommendation, PLAN_SLUGS } from '@/lib/membership-quiz';
export const runtime = 'nodejs';
export async function POST(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Please sign in to apply.' }, { status: 401 });
    const rl = rateLimit({ key: `membership-application:${user.id}`, limit: 10, windowMs: 3600000 });
    if (!rl.ok) return NextResponse.json({ error: 'Please wait before submitting again.' }, { status: 429 });
    const text = await request.text();
    if (text.length > 30000) return NextResponse.json({ error: 'Application is too large.' }, { status: 413 });
    let data;
    try { data = validateMembershipApplication(JSON.parse(text), user); }
    catch (error) { return NextResponse.json({ error: error.message }, { status: 400 }); }
    const admin = createAdminClient();
    const { data: previous, error: readError } = await admin.from('membership_applications').select('id').eq('applicant_user_id', user.id).eq('submission_key', data.submission_key).maybeSingle();
    if (readError) throw readError;
    if (previous) return NextResponse.json({ ok: true, alreadySubmitted: true });
    // Verify the file exists in this account's upload namespace, not just a claimed path.
    const folder = data.profile_photo_path.slice(0, data.profile_photo_path.lastIndexOf('/'));
    const filename = data.profile_photo_path.split('/').pop();
    const { data: files, error: photoError } = await admin.storage.from('profile-photos').list(folder, { limit: 10 });
    if (photoError || !files?.some(f => f.name === filename)) return NextResponse.json({ error: 'Please upload your profile photo again.' }, { status: 400 });
    const { data: draft, error: quizError } = await admin.from('membership_quiz_results').select('answers,quiz_version').eq('user_id', user.id).maybeSingle();
    if (quizError) throw quizError;
    if (draft?.quiz_version === QUIZ_VERSION) {
      const answers = validateQuiz(draft.answers);
      data.quiz_answers = { version: QUIZ_VERSION, ...answers, recommended_plan: PLAN_SLUGS[quizRecommendation(answers).primary] };
      data.gender_identity = answers.gender === 'private' ? null : answers.gender;
    }
    const { error } = await admin.from('membership_applications').insert(data);
    if (error) {
      if (error.code === '23505') {
        const { data: existing } = await admin.from('membership_applications').select('id').eq('applicant_user_id', user.id).eq('submission_key', data.submission_key).maybeSingle();
        if (existing) return NextResponse.json({ ok: true, alreadySubmitted: true });
      }
      throw error;
    }
    const response = NextResponse.json({ ok: true });
    return response;
  } catch {
    return NextResponse.json({ error: 'Could not submit your application. Please try again.' }, { status: 503 });
  }
}
