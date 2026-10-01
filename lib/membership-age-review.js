// Shared presentation policy. Application review uses the stored date of birth,
// never the editable quiz age or a client-supplied review flag.
export const AGE_REVIEW_TITLE = 'Additional membership review';
export const AGE_REVIEW_NOTICE = 'Stardust Garage is a 23+ club. Applicants ages 21–22 may be approved for membership following additional screening by our team. Membership is a privilege, and approval is not guaranteed. Submitting an application does not grant venue access.';

export function needsMembershipAgeReview(age) {
  return age !== '' && age != null && [21, 22].includes(Number(age));
}

export function ageOnAustinDate(birthday, at = new Date()) {
  if (typeof birthday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const birth = new Date(`${birthday}T00:00:00Z`);
  const date = new Date(at);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(date.getTime())
    || birth.toISOString().slice(0, 10) !== birthday) return null;
  const today = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter(p => ['year', 'month', 'day'].includes(p.type)).map(p => [p.type, Number(p.value)]));
  let age = today.year - birth.getUTCFullYear();
  if (today.month < birth.getUTCMonth() + 1
    || (today.month === birth.getUTCMonth() + 1 && today.day < birth.getUTCDate())) age--;
  return age >= 0 && age <= 120 ? age : null;
}

export function applicationAgeReview(application, now = new Date()) {
  // Keep the age-at-application flag stable if review happens after a birthday.
  // Legacy rows without a timestamp can still surface a current-age warning.
  const age = ageOnAustinDate(application.birthday, application.created_at || now);
  return { age, required: needsMembershipAgeReview(age), atSubmission: Boolean(application.created_at) };
}
