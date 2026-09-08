// lib/waiver/versions.js
//
// The one place where waiver text lives in code. Any edit to a body here
// MUST come with a new slug + version bump. Never edit an existing version
// in place — historical records must resolve back to the exact text shown
// at accept time.
//
// The seed script (scripts/seed-waiver.mjs) inserts every ACTIVE version
// listed here into public.waiver_versions, and marks the previously active
// row of the same `kind` inactive.

import { createHash } from "node:crypto";

/** @typedef {{
 *   slug: string,
 *   version: string,
 *   kind: 'ticket',
 *   effectiveAt: string,        // ISO date, informational
 *   checkboxLabel: string,
 *   bodyMarkdown: string,
 *   active: boolean,
 * }} WaiverVersion
 */

const TICKET_V1_LABEL =
  "I have read and agree to the Stardust Garage Assumption of Risk, Waiver, and Release of Liability, the Photo/Video Release, and the No-Refund Policy shown below. I am 18 or older.";

// Full body — MUST match ticket-waiver-checkbox.md paragraph-for-paragraph.
// Keep this as a single string constant; hash is derived deterministically.
const TICKET_V1_BODY = `### ASSUMPTION OF RISK, WAIVER, AND RELEASE OF LIABILITY

**PLEASE READ CAREFULLY. THIS IS A LEGAL DOCUMENT THAT AFFECTS YOUR LEGAL RIGHTS. BY CHECKING THE BOX BELOW AND COMPLETING THIS TRANSACTION (WHETHER PAID, FREE, RSVP, MEMBER-CLAIMED, COMPLIMENTARY, OR OTHERWISE), YOU ARE ENTERING INTO A BINDING AGREEMENT WITH STARDUST GARAGE.**

For good and valuable consideration, including the issuance of a ticket, admission, RSVP confirmation, or entry credential (whether paid or free), the sufficiency of which is expressly acknowledged, I, the undersigned ticket holder, attendee, guest, member, or invitee ("**Attendee**," "**I**," or "**me**"), on behalf of myself, my heirs, spouse, children, personal representatives, executors, administrators, assigns, and next of kin, hereby agree as follows with Stardust Garage LLC, its owners, officers, members, managers, directors, employees, agents, independent contractors, security personnel, volunteers, promoters, event producers, performers, sponsors, insurers, landlords, and affiliated entities (collectively, "**Stardust Garage**"):

**1. Acknowledgment and Assumption of Inherent Risks.**
I acknowledge that attending events, entering the premises, and participating in any activity at or associated with Stardust Garage — including but not limited to warehouse events, nightlife events, day parties, DJ and live music performances, membership events, private events, and any other programming — involves **inherent and unavoidable risks of personal injury, illness, disability, permanent disability, death, property damage, emotional distress, and financial loss**. These risks include, without limitation:

(a) crowded and densely occupied spaces, crowd surges, pushing, shoving, moshing, dancing, and physical contact with other attendees;
(b) service and consumption of alcoholic beverages by me and by others, and the conduct of intoxicated persons;
(c) loud amplified music, sub-bass frequencies, strobe lights, lasers, fog, haze, pyrotechnics, and other production elements that may cause hearing loss, seizures, disorientation, or injury;
(d) slip, trip, and fall hazards, including wet floors, spilled beverages, uneven surfaces, cords, stairs, ramps, and dark or low-light conditions;
(e) exposure to communicable diseases, viruses, and illnesses transmitted person-to-person;
(f) criminal acts, intentional torts, harassment, assault, battery, theft, or negligent acts of other attendees, guests, third parties, performers, vendors, or trespassers;
(g) equipment failure, structural conditions of a warehouse venue, temperature extremes, and lack of climate control;
(h) travel to and from the venue, including parking areas, sidewalks, and surrounding streets; and
(i) any other risk, whether foreseeable or unforeseeable, ordinary or extraordinary, inherent in attending a nightlife, warehouse, or event venue.

**I VOLUNTARILY AND KNOWINGLY ASSUME ALL SUCH RISKS**, whether known or unknown, and whether or not described above, and I accept sole personal responsibility for any resulting loss, cost, injury, damage, or claim.

**2. Express Release and Waiver of Claims (Including Negligence).**
To the fullest extent permitted by the laws of the State of Texas, I **RELEASE, WAIVE, DISCHARGE, HOLD HARMLESS, AND COVENANT NOT TO SUE** Stardust Garage from any and all claims, demands, actions, causes of action, suits, judgments, liabilities, damages, losses, costs, and expenses of every kind and nature (including reasonable attorneys' fees and court costs), whether known or unknown, foreseen or unforeseen, arising out of, resulting from, or in any way related to my attendance at, entry into, presence at, or participation in any event, activity, or use of the premises of Stardust Garage, **INCLUDING CLAIMS ARISING FROM OR CAUSED IN WHOLE OR IN PART BY THE ORDINARY NEGLIGENCE OF STARDUST GARAGE OR ANY PERSON OR ENTITY RELEASED HEREUNDER.**

**3. Carve-Out (Gross Negligence, Willful Misconduct, Non-Waivable Rights).**
Nothing in this Agreement releases, waives, or limits liability for **gross negligence, willful misconduct, or intentional acts** of Stardust Garage, or any other liability that, as a matter of Texas law, cannot be waived, released, or limited by agreement. Any such non-waivable claim is expressly preserved.

**4. Indemnification.**
To the fullest extent permitted by Texas law, I agree to **indemnify, defend, and hold harmless** Stardust Garage from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) brought by me, my guests, or any third party arising out of or related to: (a) my acts, omissions, or conduct at or in connection with the venue or event; (b) my violation of any venue rule, applicable law, or this Agreement; or (c) any injury, damage, or loss I cause to any person or property. This indemnity survives the event and this Agreement.

**5. Alcohol, Age, and Conduct Representations.**
I represent and warrant that: (a) I am at least **21 years of age** if I intend to consume alcoholic beverages, and I will produce valid government-issued photo identification on request; (b) I will not provide alcohol to any person under 21; (c) I will comply with all rules of the venue, the directions of Stardust Garage staff and security, all applicable federal, state, and local laws, and all requirements of the Texas Alcoholic Beverage Commission (TABC); (d) I will not enter or remain on the premises if I am visibly intoxicated or a danger to myself or others; and (e) I understand that Stardust Garage may refuse entry, refuse service, or eject me at its sole discretion, without refund.

**6. Medical Consent and Emergency Care.**
I authorize Stardust Garage, in the event of an injury or medical emergency, to summon emergency medical services on my behalf and consent to any reasonable first aid or emergency care administered. I acknowledge that I am solely responsible for the cost of any medical treatment.

**7. Photography, Video, and Recording Release.**
I acknowledge that events at Stardust Garage are routinely photographed, recorded, filmed, and live-streamed. I **irrevocably grant Stardust Garage and its designees the perpetual, worldwide, royalty-free right and license** to record, photograph, film, broadcast, edit, reproduce, publish, distribute, and use my name, likeness, image, voice, and biographical information in any media now known or later developed, for any promotional, marketing, commercial, editorial, archival, or other lawful purpose, without further notice, approval, compensation, or credit to me. I waive any right to inspect or approve such use.

**8. No Refund; Event Changes; Force Majeure.**
All ticket sales, RSVPs, and admission grants are **final and non-refundable**, except as expressly stated in a written refund policy published by Stardust Garage or as required by applicable law. Stardust Garage reserves the right to change lineups, set times, performers, dates, venues, capacity, entry requirements, and event details at any time. Neither party shall be liable for delay or failure to perform due to causes beyond its reasonable control, including acts of God, weather, fire, flood, pandemic or public-health orders, government action, permit revocation, power failure, labor disputes, or civil unrest.

**9. Ejection; Trespass; Search.**
I consent to reasonable bag checks, pat-down searches, and use of metal detectors as a condition of entry. I understand that failure to consent may result in denial of entry without refund. I acknowledge that Stardust Garage may eject me at any time for violation of venue rules, applicable law, this Agreement, or for any other lawful reason, without refund, and that once ejected I may be considered a **criminal trespasser** if I return.

**10. Governing Law; Exclusive Venue; Jury Waiver.**
This Agreement shall be governed by and construed under the laws of the **State of Texas**, without regard to its conflict-of-laws principles. Any action, claim, or proceeding arising out of or relating to this Agreement, the event, or my attendance shall be brought **exclusively in the state or federal courts located in Travis County, Texas**, and I consent to personal jurisdiction and venue in those courts. **TO THE FULLEST EXTENT PERMITTED BY LAW, I KNOWINGLY, VOLUNTARILY, AND INTENTIONALLY WAIVE ANY RIGHT TO A TRIAL BY JURY** in any such action or proceeding.

**11. Limitation of Liability.**
To the fullest extent permitted by Texas law, in no event shall Stardust Garage's aggregate liability to me for any and all claims arising out of or related to this Agreement, my ticket, or the event exceed the greater of (a) the amount I actually paid for the ticket or admission, or (b) **one hundred U.S. dollars (US$100.00)**. In no event shall Stardust Garage be liable for any indirect, incidental, consequential, special, punitive, or exemplary damages.

**12. Severability; No Waiver; Entire Agreement.**
If any provision of this Agreement is held to be invalid, illegal, or unenforceable, the remaining provisions shall remain in full force and effect, and the invalid provision shall be reformed to the minimum extent necessary to make it enforceable while preserving its intent. Failure to enforce any provision is not a waiver of the right to enforce it later. This Agreement, together with any written venue rules, membership terms, and refund policy published by Stardust Garage, constitutes the **entire agreement** between me and Stardust Garage regarding the subject matter and supersedes any prior oral or written understandings.

**13. Electronic Signature and Consent.**
I agree that checking the acceptance box, clicking to complete this transaction, or otherwise submitting this order constitutes my **electronic signature** and manifests my intent to be legally bound by this Agreement to the same extent as a handwritten signature, under the **Texas Uniform Electronic Transactions Act (Tex. Bus. & Com. Code Ch. 322)** and the federal **E-SIGN Act (15 U.S.C. § 7001 et seq.)**. I consent to receive this Agreement and all related records in electronic form.

**14. On Behalf of Guests and Minors.**
If I am purchasing, reserving, or claiming a ticket, RSVP, or admission for any other person, I represent that I am authorized to accept this Agreement on their behalf and that I will provide this Agreement to them prior to entry, and their entry constitutes their acceptance. **Attendees under 18 are not permitted except at specifically designated all-ages events; for any such event, a parent or legal guardian must separately sign a minor waiver — this checkbox waiver is not sufficient for a minor.**

**15. Acknowledgment.**
I acknowledge that I have had the opportunity to read this Agreement in full, that I understand it, that I am signing it voluntarily and without duress, and that I am at least 18 years of age (or a parent or legal guardian acting on behalf of a minor at a designated all-ages event with a separate minor waiver).

---

**Agreement Version:** 1.0
**Effective Date:** 2026-09-07
**Contracting Entity:** Stardust Garage LLC, Travis County, Texas`;

/** @type {WaiverVersion[]} */
export const WAIVER_VERSIONS = [
  {
    slug: "ticket_v1",
    version: "1.0",
    kind: "ticket",
    effectiveAt: "2026-09-07",
    checkboxLabel: TICKET_V1_LABEL,
    bodyMarkdown: TICKET_V1_BODY,
    active: true,
  },
];

/** SHA-256 hex (uppercase) of a body string. Matches DB CHECK constraint. */
export function hashBody(body) {
  return createHash("sha256").update(body, "utf8").digest("hex").toUpperCase();
}

/** Return the currently-active waiver for a kind (default 'ticket'). */
export function activeWaiver(kind = "ticket") {
  const v = WAIVER_VERSIONS.find((w) => w.kind === kind && w.active);
  if (!v) throw new Error(`No active waiver for kind=${kind}`);
  return {
    ...v,
    bodySha256: hashBody(v.bodyMarkdown),
  };
}

/** Return a version by slug (for verifying an acceptance record). */
export function waiverBySlug(slug) {
  const v = WAIVER_VERSIONS.find((w) => w.slug === slug);
  if (!v) return null;
  return { ...v, bodySha256: hashBody(v.bodyMarkdown) };
}

/** Public-safe payload for the checkout page (no secrets, deterministic). */
export function publicWaiverPayload(kind = "ticket") {
  const w = activeWaiver(kind);
  return {
    slug: w.slug,
    version: w.version,
    kind: w.kind,
    checkboxLabel: w.checkboxLabel,
    bodyMarkdown: w.bodyMarkdown,
    bodySha256: w.bodySha256,
  };
}
