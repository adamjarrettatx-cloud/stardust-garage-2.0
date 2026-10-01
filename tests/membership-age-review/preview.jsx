// Isolated preview of real production components. No Supabase, real users,
// persisted applications, emails or approval calls.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MembershipQuiz from '../../app/members/MembershipQuiz';
import ApplyForm from '../../app/members/apply/[plan]/ApplyForm';
import ApplicationsList from '../../app/bananas/applications/ApplicationsList';
import ApplicationAgeReview from '../../app/bananas/applications/ApplicationAgeReview';
import { applicationAgeReview } from '../../lib/membership-age-review';
import { validateQuiz, quizRecommendation, PLAN_SLUGS } from '../../lib/membership-quiz';
import content from '../../lib/customer-content.json';
import './preview.css';

window.fetch = async (url, options = {}) => {
  if (url === '/api/members/quiz') {
    try {
      const body = JSON.parse(options.body);
      const answers = validateQuiz(body.answers);
      const recommendation = quizRecommendation(answers);
      const selectedPlan = body.selectedPlan || recommendation.primary;
      return Response.json({ recommendation, selectedPlan, next: `/members/apply/${PLAN_SLUGS[selectedPlan]}` });
    } catch (e) { return Response.json({ error: e.message }, { status: 400 }); }
  }
  return Response.json({ error: 'Preview only: no real submissions or approvals.' }, { status: 403 });
};

const applications = [21, 22, 23].map(age => {
  const row = {
    id: `synthetic-${age}`, full_name: `Example Applicant ${age}`, birthday: `${2026 - age}-01-01`,
    created_at: '2026-10-01T15:00:00Z', status: 'new', plan: 'weekender',
    email: `example-${age}@example.invalid`, phone: '5125550100', social_handle: '@example',
  };
  return { ...row, age_review: applicationAgeReview(row) };
});

function Preview() {
  const [view, setView] = useState('quiz');
  const [dark, setDark] = useState(true);
  window.__previewNavigate = url => setView(url.includes('applications/') ? 'review' : 'application');
  return (
    <div className={`preview ${dark ? 'dark' : 'light'}`}>
      <nav className="preview-nav" aria-label="Preview controls">
        <span>SDG · Synthetic preview</span>
        {['quiz', 'application', 'review'].map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'quiz' ? 'Age notice' : v === 'application' ? 'Application form' : 'Team review'}</button>)}
        <button onClick={() => setDark(!dark)}>{dark ? 'Light' : 'Dark'} theme</button>
      </nav>
      {view === 'quiz' && <MembershipQuiz plans={content.membership.plans} />}
      {view === 'application' && <section className="preview-form"><h1>Application form</h1><p>Preview only. Submissions are disabled.</p><ApplyForm planSlug="weekender" planName="The Weekender" planPrice="$49" accountEmail="example@example.invalid" accountName="Example Applicant" /></section>}
      {view === 'review' && <section className="preview-review"><h1>Membership Applications</h1><p>Synthetic records. Existing team approval permissions are unchanged.</p><ApplicationsList applications={applications} /><h2 className="preview-detail-title">Application detail: age 22</h2><ApplicationAgeReview review={applications[1].age_review} /><button className="preview-disabled" disabled>Approval disabled in this preview</button></section>}
    </div>
  );
}
createRoot(document.getElementById('root')).render(<Preview />);
