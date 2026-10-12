# Contacts directory

The directory opens directly on a list. Four section tabs with live counts sit under the heading in this order: Persons, Organizations, Venue Renter, Vendor. There is no All tab; a bare `/bananas/contacts` URL shows Persons. Artists, Promoters, and individual contacts are consolidated into Persons. Event Organizer and Collective are consolidated into Organizations; old category links still resolve to their consolidated category.

Each tab is a bookmarkable `?category=` URL (tab changes replace the URL without scrolling). The toolbar has search (press `/` to focus), a status filter, and a filtered/total count. New Contact preselects the current section. Detail and cancel links retain the originating category. Archived Contacts sits beside New Contact on desktop and under the list on phones.

Contacts render as one bordered list with hairline dividers and aligned Name, Type, Email, Phone and Instagram columns. Each row has a 40px square image (or initials) with the name and a secondary line for the point of contact and company, skipping values that repeat the name. Instagram values stored as URLs, bare names or `@handles` all display as `@handle`. Instagram hides below 1200px; below 860px rows collapse to image, name and one contact detail. Do Not Book shows a labeled badge plus a red left edge. Light/dark theme tokens, visible keyboard focus, and reduced motion are supported.

## Historical data

- `artist`, `dj`, `performer`, `promoter`, and `person` all appear under Persons, without duplicating a contact. Artist and Promoter remain independent profile tags, not top-level directory categories.
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
