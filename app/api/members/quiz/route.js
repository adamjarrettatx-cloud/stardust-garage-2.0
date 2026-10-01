import { NextResponse } from 'next/server';
import { PLAN_SLUGS, QUIZ_VERSION, quizRecommendation, validateQuiz } from '@/lib/membership-quiz';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
export const runtime = 'nodejs';
export async function POST(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  try {
    const user = await getRequestUser(request);
    if (!user) return NextResponse.json({ error: 'Please sign in to save your membership results.' }, { status: 401 });
    const limit = rateLimit({ key: `membership-quiz:${user.id}`, limit: 40, windowMs: 3600000 });
    if (!limit.ok) return NextResponse.json({ error: 'Please wait before trying again.' }, { status: 429 });
    const raw = await request.text();
    if (raw.length > 6000) return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    let answers, selectedPlan, recommendation;
    try {
      const body = JSON.parse(raw);
      answers = validateQuiz(body.answers);
      recommendation = quizRecommendation(answers);
      selectedPlan = body.selectedPlan || recommendation.primary;
      if (!Object.hasOwn(PLAN_SLUGS, selectedPlan)) throw new Error('Choose a valid membership.');
    } catch (error) { return NextResponse.json({ error: error.message || 'Invalid quiz.' }, { status: 400 }); }
    const admin = createAdminClient();
    const { error } = await admin.from('membership_quiz_results').upsert({
      user_id: user.id, quiz_version: QUIZ_VERSION, answers,
      gender_identity: answers.gender === 'private' ? null : answers.gender,
      recommended_plans: [recommendation.primary, recommendation.secondary].filter(Boolean).map(key => PLAN_SLUGS[key]),
      selected_plan: PLAN_SLUGS[selectedPlan], completed_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
    const response = NextResponse.json({ recommendation, selectedPlan, next: `/members/apply/${PLAN_SLUGS[selectedPlan]}` });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Your results could not be saved. Please try again.' }, { status: 503 });
  }
}
