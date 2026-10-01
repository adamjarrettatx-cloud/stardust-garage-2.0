import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGE_REVIEW_NOTICE, ageOnAustinDate, applicationAgeReview, needsMembershipAgeReview } from '../lib/membership-age-review.js';

test('notice targets exactly 21 and 22, including quiz string values', () => {
  for (const age of [21, 22, '21', '22']) assert.equal(needsMembershipAgeReview(age), true);
  for (const age of [undefined, null, '', 'bad', 0, 18, 20, 21.5, 23, 120, NaN]) assert.equal(needsMembershipAgeReview(age), false);
  assert.equal(AGE_REVIEW_NOTICE, 'Stardust Garage is a 23+ club. Applicants ages 21–22 may be approved for membership following additional screening by our team. Membership is a privilege, and approval is not guaranteed. Submitting an application does not grant venue access.');
});

test('DOB age uses Austin calendar day across 21st and 23rd birthdays', () => {
  for (const [birthday, before, after] of [['2005-10-01', 20, 21], ['2003-10-01', 22, 23]]) {
    assert.equal(ageOnAustinDate(birthday, '2026-10-01T04:59:59Z'), before);
    assert.equal(ageOnAustinDate(birthday, '2026-10-01T05:00:00Z'), after);
  }
  assert.equal(ageOnAustinDate('2004-02-29', '2026-02-28T18:00:00Z'), 21);
  assert.equal(ageOnAustinDate('2004-02-29', '2026-03-01T18:00:00Z'), 22);
});

test('invalid, missing, future and out-of-range DOBs cannot produce a review flag', () => {
  for (const birthday of [null, '', 'bad', '2004-02-30', '2005-02-29', '2005-1-01', '2027-01-01', '1800-01-01']) {
    assert.equal(ageOnAustinDate(birthday, '2026-10-01T12:00:00Z'), null);
    assert.equal(applicationAgeReview({ birthday, created_at: '2026-10-01T12:00:00Z' }).required, false);
  }
  assert.equal(ageOnAustinDate('2004-01-01', 'invalid-date'), null);
});

test('review derives from stored DOB at application, not quiz or forged flags', () => {
  const created_at = '2026-09-30T23:00:00Z';
  assert.deepEqual(applicationAgeReview({
    birthday: '2003-10-01', created_at, quiz_answers: { age: 40 }, age_review: { required: false },
  }, new Date('2026-12-01T12:00:00Z')), { age: 22, required: true, atSubmission: true });
  assert.deepEqual(applicationAgeReview({
    birthday: '1990-01-01', created_at, quiz_answers: { age: 21 }, age_review: { required: true },
  }), { age: 36, required: false, atSubmission: true });
  assert.deepEqual(applicationAgeReview({ birthday: '2004-01-01' }, new Date('2026-10-01T12:00:00Z')), { age: 22, required: true, atSubmission: false });
});

test('list and detail derive flags server-side; warning precedes unchanged approval controls', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const listPage = read('../app/bananas/applications/page.js');
  const list = read('../app/bananas/applications/ApplicationsList.js');
  const detail = read('../app/bananas/applications/[id]/page.js');
  const quiz = read('../app/members/MembershipQuiz.jsx');
  const application = read('../app/members/apply/[plan]/ApplyForm.js');
  assert(listPage.includes('age_review: applicationAgeReview(a)'));
  assert(list.includes('<ApplicationAgeReview review={a.age_review} compact'));
  assert(detail.indexOf('<ApplicationAgeReview review={applicationAgeReview(app)}') < detail.indexOf('<ApplicationActions'));
  assert(quiz.includes('AGE_REVIEW_NOTICE'));
  assert(!quiz.includes('Stardust Garage is a 21+ venue'));
  assert(quiz.includes('Continue to application'));
  assert(application.includes('needsMembershipAgeReview(ageOnAustinDate(form.birthday))'));
});
