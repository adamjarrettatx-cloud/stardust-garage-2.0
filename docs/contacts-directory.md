# Contacts directory

The directory opens on six category cards in this order: Artist, Organizations, Venue Renter, Vendor, Promoter, People. No All category or list appears on the initial screen. Event Organizer and Collective are consolidated into Organizations; old category links still resolve.

Each category opens a bookmarkable `?category=` list with search, status filtering, a contact count, and a link back to the category dashboard. New Contact preselects the current category. Detail and cancel links retain the originating category.

Contact rows use a full-height square image at the left edge of the rounded container. Missing or broken images use initials in the same square footprint. The rest of the contact information appears to the right. Light/dark theme tokens, visible keyboard focus, and mobile layouts are supported. Do Not Book is explicitly labeled in addition to its warning border.

## Historical data

- `artist`, `dj`, and `performer` all appear under Artist, without duplicating a contact.
- Multiple relationship types place a contact in each applicable category.
- New/edit forms offer canonical relationship tags. Historical DJ/Performer records show Artist selected; removing Artist removes those aliases deliberately.
- Organization, Event Organizer, and Collective tags display once as Organization. Ordinary edits retain legacy tags and all event/contract/partner references.
- Historical Resident/Other tags are preserved on ordinary edits, but are not selectable categories.
- `profile_kind` explicitly distinguishes a person from an organization. Legacy individual organizers remain people; other legacy organizers/collectives display as organizations without rewriting existing rows.
- Form saves require at least one of the six supported categories.

## Organization main contact

Organization profiles include a Main point of contact section, separate from the legal signer and the legacy additional-contact notes. Search spans non-archived person contacts and existing auth accounts, including free, member, team, and partner accounts. Existing accounts are linked by user ID and are never recreated. Create and link person creates only a Contacts record, not an auth account or invitation.

`organization_main_contacts` stores one main contact per organization, either a person contact ID or account user ID. The same person may represent multiple organizations. Clearing a link retains its version for concurrency checks and never deletes the person. Archived organizations cannot change their main contact.

All new RPCs independently verify the caller's team/admin role; front desk, calendar-only, ordinary accounts, and anonymous callers are denied. Direct authenticated table access is revoked. The atomic write RPC creates the optional person, changes the link, and records the audit trail in one transaction. A stale version or duplicate email fails without creating partial records. Organization/person conversion is rejected when it would invalidate an active link.

Neither linking nor creating a main contact changes portal access, membership, payment permissions, contract signers, or old contract snapshots. Existing free-text primary contact names are retained and shown until an explicit profile is linked.

### Rollout

Apply `20260923_contact_organizations.sql` before deploying the application changes. Production migration and release require owner approval. The migration is additive apart from widening the allowed contact tags; no existing contacts are reclassified or merged. Reverting the application does not require dropping the new table or deleting linked people.

### Tests

Run `npm test` for the API, helper, navigation, profile, and PostgreSQL-compatible migration/RPC regression suite. The local database test covers direct RPC authorization, one-to-many representation, email conflicts, stale writes, preserved identities, and transaction rollback on audit failure.

The isolated browser harness uses actual ContactsList/ContactForm components, synthetic contact details, and no live writes. Checks cover category order, Artist aliases, search/status filters, empty categories, browser back, category-preserving links, new-contact defaults, legacy Performer selection, missing-image fallback, long names, and desktop/mobile light/dark presentation. Production requires normal staff authentication; no real customer contacts are edited during QA.
