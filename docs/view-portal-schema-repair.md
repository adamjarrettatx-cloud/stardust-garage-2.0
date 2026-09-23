# View Portal isolated schema repair

Completed September 23, 2026 against isolated project `ygcqwohfnijjaeoobwhj`. Production project `iwgfelvbebqbaotkylsw` was used only for read-only catalog/configuration metadata; no production records, users, files, secrets or jobs were exported.

## Repair method

The original branch migration replay stopped because historical migrations referenced tables that were never included in the recorded baseline. A two-table patch would not restore the current application or its access controls.

The repair instead reconstructed a schema-only baseline from PostgreSQL catalogs. The generated SQL was staged in a non-exposed, revoked-access schema and applied inside one transaction after checking its SHA-256 digest and confirming the target was empty. Existing empty tables were extended rather than dropped.

Baseline SQL SHA-256: `c2542030781b5ad2110a13c0d6241e70980afe028cf281cfd6869b35f2d5c4a3`.

An independent post-restore catalog comparison produced:

| Metadata category | Restored | Missing | Unexpected |
|---|---:|---:|---:|
| Tables | 95 | 0 | 0 |
| Columns | 1,147 | 0 | 0 |
| Constraints | 504 | 0 | 0 |
| Standalone indexes | 249 | 0 | 0 |
| Application functions | 92 | 0 | 0 |
| Views | 1 | 0 | 0 |
| Triggers | 49 | 0 | 0 |
| Public/storage RLS policies | 251 | 0 | 0 |
| Relation grant entries | 2,830 | 0 | 0 |
| Function grant entries | 334 | 0 | 0 |
| Public schema grant entries | 7 | 0 | 0 |
| Realtime publication entries | 5 | 0 | 0 |

Three column-specific UPDATE grants were separately restored and checked. Three sequences were created with exact bigint limits and ownership, without copying their current production values. Eight empty storage bucket configurations preserve visibility, size and content-type rules; no stored objects were copied.

Catalog comparison ignores object OIDs and historical dropped-column ordinal gaps because neither carries application semantics. Managed Supabase schemas and `supabase_admin` default privileges remain platform-owned. The `pg_trgm` extension was installed to match production indexes; the production scheduler was intentionally not copied.

## Isolated changes after baseline parity

- Applied the pending Front Desk role migration.
- Applied additive partner access from PR #321.
- Created the service-only View Portal fixture and redemption registries.
- Recreated column-specific profile-edit permissions.
- Revoked database network function access from PUBLIC, anon, authenticated and service_role.
- Replaced `send-push`, `chat-notify` and `one-off-migrate-bg-track` with authenticated 403 handlers containing no outbound code.
- Kept every persona's readiness flag false.

## Synthetic test dataset

Twenty separate synthetic users have unique random credentials, reserved `.invalid` email addresses, and reserved fictional phone numbers. Each authenticated successfully against the real branch Auth service; no invitation or confirmation email was sent.

The dataset includes four paid-member profiles, three trial states, ten partner profiles with separate contacts, five staff roles/combined identities, three events covering public/internal/draft visibility, twenty complimentary orders and tickets, ten allocations and guest entries, ten bookings, ten synthetic contract records, a staff calendar event and a test capacity session.

All event/contract/contact content is explicitly labeled PREVIEW ONLY. Financial records have no real payment processor identifiers or recipients. Contract records have no signature-provider envelope or actual legal effect.

## Permission acceptance

The real Auth/PostgREST/RPC matrix executed 290 checks covering all twenty identities:

- Own and cross-account customer profiles, orders and tickets.
- Member profile visibility.
- Team calendar and public/internal event boundaries.
- Assigned partner grants, bookings and contracts.
- Disabled and invitation-pending partner denial.
- Owner identity denial for every synthetic account.
- Private registry read/write denial, including the synthetic administrator.
- Denial of partner self-activation.

The initial run found a legacy `free_accounts_team_read` policy that admitted any team-member row, including Front Desk and Calendar Viewer. The new migration `20260923010000_restricted_staff_profile_boundary.sql` restricts that directory policy to `is_team()`, preserving self-read and the intended normal-team/admin access.

After applying that correction only in the isolated branch, all 290 checks passed. The migration and an executable PGlite regression test are included in this review branch; the production policy is unchanged.

Ten additional real Storage checks passed for own upload/read/delete and cross-account/team/restricted-role boundaries. The two temporary test images were removed. All three neutralized Edge Functions were invoked with a valid synthetic JWT and returned 403. The application regression suite passed 61 API tests and 1,793 Node tests; the Next.js production build passed.

The repeatable RLS matrix is `npm run test:view-portal:permissions`. It requires `VIEW_PORTAL_MODE=sandbox`, the exact approved branch URL, its public API key, and a private `VIEW_PORTAL_TEST_SESSIONS` JSON file containing one `{persona,userId,accessToken}` entry per catalog persona. It verifies each token with Auth before making any test request. An optional `VIEW_PORTAL_TEST_REPORT` path writes a credential-free result report. Do not commit fixture passwords, sessions or API secrets.

## Outstanding deployment gates

Database acceptance does not establish full website acceptance. The branch server API key, real generated-link redemption, separate HTTPS deployment, owner MFA, cookie isolation, complete route/API navigation, storage-file flows, expiry and exit still require verification before enabling launch.

The Vercel CLI currently fails certificate signature verification during team discovery. TLS validation was not disabled. The user declined the isolated server-key request; no key was obtained and no generated-link test was attempted. Supabase's branch record still shows its original `MIGRATIONS_FAILED` status, while the database project is `ACTIVE_HEALTHY` and passes direct acceptance checks.

Do not merge, reset or rebase the Supabase branch as a shortcut. Its manually repaired baseline is not a repair of production migration history. The approved branch remains billable at the previously authorized hourly rate while this work continues.

## Advisory review

The final Supabase security scan reported no ERROR-level findings, but it was not a clean advisory scan. Eleven application functions retain a mutable search path, the matching `pg_trgm` extension lives in public, and callable SECURITY DEFINER routines need intentional-access review rather than blanket revocation ([search-path guidance](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [extension guidance](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public), [anonymous callable functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated callable functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).

The no-policy RLS notices include deliberately service-only tables and the private restore staging table. Do not add browser policies merely to silence those notices ([RLS notice guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

The branch also reports leaked-password protection disabled. Synthetic credentials are random rather than human-chosen, but this Auth setting remains a deployment review item ([password security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).
