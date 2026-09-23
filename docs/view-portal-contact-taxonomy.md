# View Portal contact categories

The owner selector follows the Contacts directory terminology:

- Persons contains Artist / DJ and Promoter role scenarios.
- Organizations has one Organization choice, with Collective and Event Organizer test scenarios.
- Vendor, Customer, Staff, Combined and access-lifecycle cases retain their existing permissions.

The Organization scenario selector is presentation only. Launch still sends the existing fixed `collective` or `organizer` persona ID. It does not add an organization login, create users, modify fixture readiness, change partner assignments, or grant access from a main-contact link.

The main contact relationship is managed from the organization profile in Contacts. A contact can be selected from Contacts or existing accounts, or created inline as a person record. Being that contact is not a new authentication role or automatic signing authority.

Owner UUID checks, MFA, signed handoff, nonce validation, sandbox isolation, expiration, and the in-preview desktop/mobile controls remain unchanged. The same catalog labels should be deployed to the isolated branch so its preview banner uses the updated terminology.

This update changes the selector and explanatory copy only. It does not synchronize unrelated production Contacts screens or migrations into the isolated database.
