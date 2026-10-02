# Four-digit staff PIN acceptance

Scope: four-digit staff PINs only. Preserve eight-digit pairing, staff identities, pay/history, paired devices, and existing request throttles. Existing six-digit credentials require an owner-selected reset, not truncation or recovery.

## QA inventory

- Shared policy and generators: four ASCII digits, including leading zeros; reject non-string, whitespace, non-ASCII, three/five/six-digit inputs. Pairing stays eight digits.
- Staff profiles: chosen four-digit creation/reset, generated four-digit reset, invalid input rejection, duplicate rejection, transition notice.
- Kiosk: four masked positions, keypad/keyboard maximum of four, Clear/Delete, Continue disabled before four digits, successful leading-zero login, wrong/old PIN rejection.
- End-to-end: pair synthetic device, log in, start shift, reset PIN, deny old PIN, sign in with replacement and resume same shift, clock out and confirm saved timesheet.
- Visual: kiosk at 1024×768 and 375×812; management at 1280×900 and 375×812. No horizontal overflow, clipped controls or obsolete six-digit entry prompts.
- Boundaries: all functional writes use the isolated local test database, not production staff. Live rollout checks will not reset the user's existing staff PIN or create payroll entries.

## Automated checks

Run `npm run test:time-clock` and `node --test tests/time-clock-theme.test.mjs`, plus production build. API tests exercise chosen/generated PINs, leading zeros, malformed inputs, duplicates, authorized managers, session security, and throttles; database tests preserve reset/session/open-shift behavior.

## Results, October 2, 2026

- 80 time-clock checks passed: 29 database, 43 API, 8 core. Both existing theme checks passed. Production Next.js build passed with existing unrelated lint warnings.
- Isolated browser flow passed: eight-digit device pairing; exactly four masked positions; keyboard/keypad cap; Continue disabled at three digits; Clear/Delete; four-digit login and clock-in.
- Reset to a chosen leading-zero PIN passed. The old PIN was rejected; the new PIN resumed the same open shift, which then clocked out and appeared in Timesheets.
- Staff-profile creation with a chosen leading-zero PIN, duplicate-PIN refusal, and blank-input generated replacement all passed. Generated replacement retained its leading zero.
- Screenshots reviewed at tablet, desktop and mobile sizes. No horizontal overflow or clipped PIN controls. Management remains vertically scrollable by design.
- Production staff credentials were not reset by QA. No production database migration is needed for this application-only change.
