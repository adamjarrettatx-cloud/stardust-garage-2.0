# W-9 verification inventory

All automated tests use synthetic records and identifiers. Browser tests mount the real React components with intercepted API responses, not production credentials.

| Requirement/control | Checks |
| --- | --- |
| Create artist and invitation | Existing invite route tests; contact saved once; `emailSent` checked; retry notice on failed send |
| Completed profile / Fill out w9 | Incomplete profile server rejection; initial desktop/mobile artist screen; audited open, cancel and reopen |
| Complete and sign | Required field validation, classification changes, certification/consent, masked TIN, submission, immutable PDF with original IRS instructions |
| Pending review | Artist waiting state; no second submission; profile refresh |
| Review and approve | Only three reviewer identities; document preview/download; confirmation checkbox; approve action |
| Deny and resubmit | Required reason; no TIN in comments; artist sees reason; new form/id; old version preserved |
| Booking/pay | Missing/pending/denied blocked by API and database; approved accepted; reassignment guarded; separate payout authorization unchanged |
| Confidentiality | Reviewer allowlist + MFA; own-contact artist read; ordinary staff readiness only; direct storage blocked; audit required before new W-9 download |
| Error states | API/network failure, duplicate submit, ambiguous DB outcome retains original PDF, invalid input and unsupported font characters fail before save |
| Responsive layout | 1440px and 375px screenshots; no horizontal overflow; long form scrolls; controls usable |

Live external email delivery and a real taxpayer's signed submission are not exercised by automated QA. No payouts are initiated.
