# Staff profiles QA

## Acceptance inventory

- Staff profiles: clearly labeled tab, create and edit profile, name and employee/contractor category, active toggle. Confirm saved values after reload.
- Compensation: assign multiple roles, hourly rate per role, change to flat fee. Verify values saved; historical snapshots covered by database tests.
- PIN: create with chosen four digits including leading zero; reset with chosen PIN or blank for generated PIN; one-time disclosure/hide. Confirm old PIN rejected and new PIN accepted at kiosk. Reject three-, five- and six-digit inputs; pairing codes remain eight digits.
- Access: verified Adam/Jeyu admin allowlist and page/API denials covered by API tests; unrelated owner navigation remains hidden in navigation tests.
- Edge cases: duplicate PIN fails without changing the existing PIN; malformed PIN rejected; reset cancel preserves state; deactivated profile denied.
- Visual: desktop 1440px, iPad landscape 1024×768, mobile 375×812. Inspect staff form and reset modal, focus trap, readable labels, no horizontal overflow. Physical Safari remains a rollout check.

Use synthetic local data only. API/session identity boundary is a fixture; this does not certify real account sign-in or production Supabase configuration.

## Observed results

Passed local browser flows: contractor creation with two hourly roles and leading-zero PIN, persisted values after reload, name/category/flat-fee edit, duplicate PIN rejection, chosen reset, old PIN kiosk denial and replacement acceptance, inactive profile denial, reactivation, blank/generated reset. Reset-dialog focus wraps correctly; no page errors or horizontal overflow at inspected desktop/tablet/mobile sizes. Assignment checkboxes are no longer styled as completed tasks.

Automated checks: 59 time-clock tests, 96 navigation/theme tests, 47 existing security tests passed. Lint and production build passed. Real iPad Safari, real manager sign-in and production PostgREST remain unverified.
