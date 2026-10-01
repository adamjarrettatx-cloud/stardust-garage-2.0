import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyQuiz, validateQuiz, quizBranch, quizRecommendation, QUIZ_QUESTIONS } from '../lib/membership-quiz.js';
import { validateMembershipApplication } from '../lib/membership-application.js';
const quiz = patch => ({ ...emptyQuiz(), age: 30, gender: 'female', interests: ['night'], activities: ['night'], priority: 'night', ...patch });
test('exact age, 21+ threshold, max three interests and distinct approved choices', () => {
  for (const age of ['', 20, 21.5, 121, 'bad']) assert.throws(() => validateQuiz(quiz({ age })));
  for (const age of [21, 24, 25, 80]) assert.equal(validateQuiz(quiz({ age })).age, age);
  assert.equal(validateQuiz(quiz({ interests: ['night', 'work', 'community'], branch: 'simple' })).interests.length, 3);
  for (const interests of [[], ['night', 'work', 'studio', 'experience'], ['night', 'night'], ['night', 'unsure'], ['invented']]) assert.throws(() => validateQuiz(quiz({ interests })));
  assert.equal(QUIZ_QUESTIONS[2].options.length, 8);
  assert.throws(() => validateQuiz(quiz({ activities: ['movies', 'unsure'] })));
});
test('all three plans, no Insider age 25 restriction, gender never ranks', () => {
  const cases = [[quiz(), 'weekender'], [quiz({ interests: ['work'], activities: ['work'], priority: 'work' }), 'builder'], [quiz({ age: 21, priority: 'insider' }), 'insider'], [quiz({ priority: 'mix' }), 'insider']];
  for (const [answers, expected] of cases) for (const gender of ['male', 'female', 'other', 'private']) assert.equal(quizRecommendation(validateQuiz({ ...answers, gender })).primary, expected);
});
test('each curated activity is an independent Insider signal', () => {
  for (const activity of ['movies', 'wellness', 'producer', 'exclusive', 'studio']) {
    const a = validateQuiz(quiz({ interests: ['unsure'], activities: [activity], priority: 'unsure' }));
    assert.equal(quizRecommendation(a).primary, 'insider', activity);
  }
});
test('community does not imply studio; undecided users get a clarifier', () => {
  const a = quiz({ interests: ['community'], activities: ['unsure'], priority: 'unsure' });
  assert.equal(quizBranch(a), 'explore'); assert.throws(() => validateQuiz(a));
  assert.equal(quizRecommendation(validateQuiz({ ...a, branch: 'try-work' })).primary, 'builder');
});
test('mixed-interest branches, two options, invalid and stale branches', () => {
  for (const priority of ['night', 'work']) {
    const a = quiz({ interests: ['night', 'work'], activities: ['exclusive'], priority });
    assert.equal(quizBranch(a), priority); assert.throws(() => validateQuiz(a));
    const both = quizRecommendation(validateQuiz({ ...a, branch: 'both' }));
    assert.equal(both.primary, priority === 'night' ? 'weekender' : 'builder'); assert.equal(both.secondary, 'insider');
    assert.equal(quizRecommendation(validateQuiz({ ...a, branch: 'expanded' })).primary, 'insider');
  }
  assert.equal(validateQuiz(quiz({ branch: 'expanded' })).branch, '');
});
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'account@example.invalid' };
const application = patch => ({
  plan: 'cowork-party', submission_key: '00000000-0000-4000-8000-000000000002',
  full_name: 'Test Person', preferred_name: null, website: null, email: 'spoof@example.invalid',
  phone: '5125550100', social_handle: '@example', birthday: '1990-01-01',
  why_stardust: 'Community', how_did_you_hear: 'A friend', how_contribute: 'Art', what_experiences: 'Movie nights',
  agreed_ethos: true, agreed_renewal: true, agreed_house_rules: true,
  profile_photo_path: `member-app/${user.id}/00000000-0000-4000-8000-000000000003/photo.jpg`, ...patch,
});
test('applications derive identity/status from server and validate required fields', () => {
  const row = validateMembershipApplication(application({ applicant_user_id: 'forged', status: 'approved' }), user);
  assert.equal(row.email, user.email); assert.equal(row.applicant_user_id, user.id); assert.equal(row.status, 'new'); assert.equal(row.preferred_name, '');
  for (const patch of [{ plan: 'insider' }, { full_name: 'Single' }, { birthday: '2020-01-01' }, { birthday: '2000-02-31' }, { agreed_ethos: false }, { phone: '' }, { profile_photo_path: 'member-app/another/photo.jpg' }, { submission_key: 'bad' }]) assert.throws(() => validateMembershipApplication(application(patch), user));
});
test('21st birthday uses Austin date, not UTC rollover', () => {
  assert.throws(() => validateMembershipApplication(application({ birthday: '2005-10-01' }), user, new Date('2026-10-01T02:00:00Z')));
  assert.doesNotThrow(() => validateMembershipApplication(application({ birthday: '2005-10-01' }), user, new Date('2026-10-01T06:00:00Z')));
});
