import test from 'node:test';
import assert from 'node:assert/strict';
import { profileCapabilities } from '../lib/profile-capabilities.js';
import { partnerViews } from '../lib/partner-access.js';
import { roleLabel, portalName } from '../lib/role-label.js';
import { contactMatchesDirectorySection, CONTACT_TYPE_OPTIONS, isProgrammerContact, contactTypeLabel } from '../lib/contact-helpers.js';
import { buildAccountProfile } from '../lib/account-profile.js';
import { CREATABLE_STATION_ROLES, STATION_ROLE_LABELS } from '../lib/station-policy.js';
import { parsePitchInput, timeLabel, timeRangeLabel, longDateLabel, groupCalendarMonths, pitchErrorResponse, attendanceLabel } from '../lib/date-pitches.js';

test('Programmer is a person contact type with calendar and pitches only', () => {
  assert.ok(CONTACT_TYPE_OPTIONS.some((o) => o.value === 'programmer' && o.label === 'Programmer'));
  assert.equal(contactTypeLabel('programmer'), 'Programmer');
  assert.equal(isProgrammerContact(['programmer']), true);
  assert.equal(isProgrammerContact(['dj']), false);
  assert.equal(contactMatchesDirectorySection(['programmer'], 'person'), true);
  assert.equal(roleLabel(['programmer']), 'Programmer');
  assert.equal(roleLabel(['programmer'], { plural: true }), 'Programmers');
  assert.equal(portalName(['programmer', 'event_organizer']), 'Programmer Portal');
  assert.deepEqual(profileCapabilities(['programmer']), { guestList: false, pay: false, contracts: false, events: false, calendar: true, pitches: true });
  assert.equal(profileCapabilities(['dj']).calendar, false);
  const views = partnerViews(['programmer']);
  assert.deepEqual(views, { guestList: false, pay: false, contracts: false, events: false, calendar: true, pitches: true });
});

test('profile workspaces link a Programmer to Calendar and My pitches', () => {
  const profile = buildAccountProfile({ partner: { contact_type: ['programmer'], is_active: true, activated_at: '2026-10-01' } });
  assert.deepEqual(profile.workspaces.map((w) => w.href), ['/portal/calendar', '/portal/pitches']);
});

test('Calendar Availability is no longer offered for new stations', () => {
  assert.deepEqual(CREATABLE_STATION_ROLES, ['front_desk', 'security']);
  assert.equal(STATION_ROLE_LABELS.calendar_availability, 'Calendar Availability');
});

test('pitch input validation and labels', () => {
  const good = { date: '2026-11-20', title: ' Velvet Static ', concept: 'Shoegaze', lineup: '', startTime: '22:00', endTime: '02:00', expectedAttendance: '100_250', notes: '' };
  assert.deepEqual(parsePitchInput(good).value, {
    p_date: '2026-11-20', p_title: 'Velvet Static', p_concept: 'Shoegaze', p_lineup: null,
    p_start_time: '22:00', p_end_time: '02:00', p_expected_attendance: '100_250', p_notes: null,
  });
  assert.match(parsePitchInput({ ...good, date: 'soon' }).error, /date/);
  assert.match(parsePitchInput({ ...good, title: '' }).error, /event name/);
  assert.match(parsePitchInput({ ...good, concept: ' ' }).error, /concept/);
  assert.match(parsePitchInput({ ...good, startTime: '25:00' }).error, /start and end/);
  assert.match(parsePitchInput({ ...good, endTime: '22:00' }).error, /same/);
  assert.match(parsePitchInput({ ...good, expectedAttendance: 'lots' }).error, /attendance/);
  assert.match(parsePitchInput({ ...good, title: 'x'.repeat(121) }).error, /under 120/);
  assert.equal(timeLabel('00:00'), '12:00 AM');
  assert.equal(timeLabel('12:30'), '12:30 PM');
  assert.equal(timeRangeLabel('22:00', '02:00'), '10:00 PM – 2:00 AM');
  assert.equal(longDateLabel('2026-11-20'), 'Friday, November 20, 2026');
  assert.equal(attendanceLabel('400_plus'), '400+');
  assert.equal(pitchErrorResponse({ code: '22023', message: 'That date is no longer open.' }).status, 409);
  assert.equal(pitchErrorResponse({ code: 'XX000', message: 'internal detail' }).error, 'Something went wrong. Please try again.');
});

test('calendar rows group into months with the weekday of the 1st', () => {
  const months = groupCalendarMonths([
    { day: '2026-10-30', state: 'open' }, { day: '2026-10-31', state: 'public' }, { day: '2026-11-01', state: 'open' },
  ]);
  assert.deepEqual(months.map((m) => [m.key, m.label, m.firstWeekday, m.days.length]), [
    ['2026-10', 'October 2026', 4, 2], ['2026-11', 'November 2026', 0, 1],
  ]);
});
