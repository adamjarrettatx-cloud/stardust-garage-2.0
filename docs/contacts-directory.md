# Contacts directory

The directory opens on six category cards in this order: Artist, Event Organizer, Venue Renter, Vendor, Collective, Promoter. No All category or list appears on the initial screen.

Each category opens a bookmarkable `?category=` list with search, status filtering, a contact count, and a link back to the category dashboard. New Contact preselects the current category. Detail and cancel links retain the originating category.

Contact rows use a full-height square image at the left edge of the rounded container. Missing or broken images use initials in the same square footprint. The rest of the contact information appears to the right. Light/dark theme tokens, visible keyboard focus, and mobile layouts are supported. Do Not Book is explicitly labeled in addition to its warning border.

## Historical data

- `artist`, `dj`, and `performer` all appear under Artist, without duplicating a contact.
- Multiple relationship types place a contact in each applicable category.
- New/edit forms offer only the six categories. Historical DJ/Performer records show Artist selected; removing Artist removes those aliases deliberately.
- Historical Resident/Other tags are preserved on ordinary edits, but are not selectable categories.
- No records, booking relationships, payment eligibility, permissions, or database schema are changed by this release.
- Form saves require at least one of the six supported categories.

## Verification

The isolated browser harness uses actual ContactsList/ContactForm components, synthetic contact details, and no live writes. Checks cover category order, Artist aliases, search/status filters, empty categories, browser back, category-preserving links, new-contact defaults, legacy Performer selection, missing-image fallback, long names, and desktop/mobile light/dark presentation. Production requires normal staff authentication; no real customer contacts are edited during QA.
