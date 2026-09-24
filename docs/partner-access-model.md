# Partner profiles and access

## Identity model

One Supabase authentication identity can hold a customer account, a membership or trial, and an active partner profile. Partner contact tags describe a business relationship; they do not confer membership benefits or staff privileges. This change preserves existing records rather than merging names, photos or contact identities.

## Access matrix

| Capability | Authority | Allowed views and actions |
|---|---|---|
| Customer account | Authenticated identity; existing customer gates | Own account and tickets |
| Member or trial | Existing membership/trial records and expiry checks | Existing membership/trial surfaces; partner status does not change benefits |
| Active partner | Active partner profile linked to the authenticated user | Own partner profile and assigned guest-list grants, bookings and non-draft contracts |
| Invited partner | Pending profile, never activated | Activation only; no partner resource access |
| Disabled partner | Inactive profile with activation history | No partner access; customer membership remains unchanged |
| Team | Server-controlled team role | Existing staff permissions; own partner view only if independently linked |
| Admin | Server-controlled admin role | Existing admin permissions; no fake partner impersonation view |
| Front desk | Dedicated front_desk role | Existing front-desk web workspace only, not native full-team tools |
| Calendar viewer | Dedicated calendar_viewer role | Existing calendar web workspace only, not native full-team tools |

## Partner views

- Profile is the web portal landing page for every partner type.
- Guest List navigation is shown for relevant contact types or an existing allocation. Adding guests still requires ownership and available allocation; a label alone grants nothing.
- Bookings & Pay navigation is shown for contractor types or assigned bookings. Request-pay eligibility and amounts remain server-authoritative.
- Contracts navigation is shown for relevant contact types or assigned non-draft contracts. Signing remains in the existing signature-email workflow; completed-copy download still checks ownership and signed status.
- My Account returns to the same user's customer account without signing out.
- Native free, trial, member and team account surfaces link to the existing native partner profile. The signed-in view chooser lists only eligible views.
- Native navigation menus follow the selected authorized view, including for people with both staff and customer/partner identities.

## Security changes

- Web no longer diverts an active partner away from their member area.
- Editable auth metadata cannot grant the web admin middleware gate.
- Partner profile, request-pay and contract-download APIs accept either verified bearer authentication or web session cookies and retain ownership checks.
- Re-sending a partner invite preserves activation, name and photo and refuses silent identity reassignment.
- Disabled partner profiles cannot self-reactivate through the activation endpoint.
- Expired legacy trial profiles cannot fall through to full-member navigation merely because their stored `is_active` flag remains true.
- A database migration excludes restricted staff accounts from partner_contact_id(), covering all dependent partner RPCs and grant ownership policies even if a client bypasses the web.

## Release sequence

1. Review both web and mobile branches and confirm the access matrix.
2. Apply `20260923000000_additive_partner_access.sql` after reviewing the restricted-role behavior.
3. Release the web changes and verify active-partner + member, active-partner + trial, invitation, disabled profile, cross-partner access, and restricted staff cases.
4. Build and distribute an updated mobile binary; a GitHub push alone does not update TestFlight.
5. Validate view switching and revoke access while the app is backgrounded, then return to it.

## Remaining scope

This is the access/navigation foundation, not a claim that all partner screens are finished. Native contracts, bookings/pay, profile editing/activation, and an administrator-facing capability editor still need their own UI review and implementation. Customer and partner name/photo storage is not yet a unified editable record. Automatic guest-invite signup-to-pass linkage and email reliability are separate workstreams.
