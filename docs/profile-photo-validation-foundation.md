# Profile Photo Validation Foundation

This milestone supplies reusable backend primitives and an additive migration. It does not enable face checking for customer uploads, change existing upload routes, or claim to verify a person's identity.

## Included

- Strict TypeScript contracts and provider-neutral `face_photo_v1` policy.
- AWS `DetectFaces` adapter with explicit processing/privacy gates, restricted requested attributes, one SDK attempt, and a six-second abort.
- Image normalization with source/output byte limits, decoded MIME checking, pixel limits, EXIF orientation, metadata stripping, and bounded JPEG output.
- Private temporary storage bucket plus service-only upload, immutable asset, canonical subject, event, and cleanup-job tables.
- Account-subject claim/retry/reject/commit database functions, revision conflict checks, lease expiry, terminal replay, audit records, and cleanup scheduling.
- Tests for policy, provider parsing, image processing, configuration, and actual migration execution in PGlite.

## Safety boundary

No HTTP endpoint, client component, or scheduled job imports the new adapter. Provider calls require `PROFILE_PHOTO_MODE=shadow|enforce`, `PROFILE_PHOTO_PRIVACY_READY=true`, `PROFILE_PHOTO_PROVIDER=aws_rekognition`, and `AWS_REGION`; configuration is an attestation gate, not a substitute for privacy approval.

Unset mode defaults to `legacy`. Invalid mode values resolve to `paused`; they never silently downgrade an enforcement setting.

The commit function trusts the privileged server to authenticate the user, evaluate the policy, and write the exact normalized bytes first. SQL verifies the account, upload lease, immutable path/metadata, policy version, expiry, and expected subject revision; it does not detect faces or inspect Storage bytes.

The current SQL commit handles the account context only. Other contexts have reserved schema/type values but no implemented attachment path.

## Verification commands

```sh
npm ci
npm run typecheck:profile-photos
npm run test:profile-photos
npm test
npm run build
```

`npm test` runs the focused type check and photo tests through `pretest`. Tests send no photos to AWS and require no production credentials.

## Follow-up before live use

- Implement authenticated/context-scoped initiation, completion, and status APIs with runtime validation, CSRF protection where cookies are used, durable limiting, and uncertain-commit recovery.
- Create accepted assets only after evaluating the exact normalized bytes written to immutable final storage.
- Distinguish terminal rejected/expired results from accepted results. Replay is not automatically success.
- Never delete a final object after an ambiguous database commit response without first resolving whether it became active.
- Implement reference-aware cleanup, repeated sweeps after signed-upload capability expiry, abandoned/orphan object cleanup, and account-deletion integration.
- Test actual Supabase Storage permissions in an isolated environment; local tests use a minimal preceding schema.
- Verify HEIC/HEIF support in the deployment decoder, then test consented representative portraits with the actual provider.
- Complete Trial Pass, application-draft, partner-person, manual-review, and lifecycle propagation workflows.
- Integrate web/mobile clients and protect every legacy attachment path before enabling enforcement.
- Finish provider privacy/retention configuration, legal and disclosure review, calibration, monitoring, and operational exception handling.

The migration must be separately reviewed and applied. No production migration, provider configuration, deployment, or user-facing enablement is part of this milestone.
