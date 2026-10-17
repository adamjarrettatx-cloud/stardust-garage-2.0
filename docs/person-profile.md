# Person Profile

Admin page at `/bananas/people/<source>-<uuid>`, opened from every people
search result. One profile per person across Guest, Trial, Member and
Applicant records.

## Identity

`lib/person-profile/identity.js` starts from the clicked record and follows
account links (`user_id`), explicit record links (`application_id`,
`member_profile_id`, `guest_profile_id`) and email. Phone is shown but never
joins records. Capped at 25 records per kind and 6 emails so a shared address
can't fold many people together.

## What is counted

- **Visits**: one per venue night (America/Chicago, 6am cutoff) from door
  admissions, front desk arrivals, Trial Pass check-ins, member ID scans,
  guest list check-ins, used tickets, and legacy Ticket Tailor tickets. A
  front desk night with no event is matched to that night's single guest
  event. Ticket Tailor check-ins with a buyer email were never synced, so a
  valid TT ticket for an event that has happened counts as attended.
- **Spend**: Stripe ticket orders net of refunds, studio bookings, and paid
  Stripe membership invoices (fetched live). Bar (SpotOn) sales and Ticket
  Tailor prices are not linked to customers and are excluded.
- **Guests brought**: extra non-refunded tickets on their own orders for
  events that have happened.
- **Top X% by visits**: venue-wide visit nights per person
  (`lib/person-profile/loyalty.js`), cached 10 minutes. Shown for top 1/5/10/25%.
- **Flags**: security incidents and access restrictions matched by identity
  key, read-only. Lifting and deletion stay in Security.

## Notes and tags

Tables `person_notes` and `person_tags` (migration
`20261017200000_person_notes_and_tags.sql`). Service-role only; routes under
`/api/admin/people/[ref]/` require admin + MFA. Rows store every identity key
the person had when written and are read by overlap, so they follow the
person from Trial to Member. Author-only edit; author or owner delete; soft
deletes. Any admin can add or remove tags.

Send message and Gift ticket are disabled placeholders for later phases.
