# View Portal sandbox deployment branch

`deploy/owner-view-portal` is a hosting-only derivative of `feat/owner-view-portal`.
Do not merge this branch into main or into the feature PR: it intentionally
removes every Vercel scheduled job and requires sandbox mode before building.
Production hosting configuration remains on the feature/main branches.

Create a separate Vercel project named `sdg-view-portal`. Do not attach the live
domain, copy production environment variables, or add automatic integrations.
If the import flow requires an initial default-branch build, temporarily override
the Install Command with `exit 1` so no application can be deployed. Then configure
this new project's Production environment Branch Tracking to
`deploy/owner-view-portal` before restoring installation defaults. Here Production
is Vercel's label for this separate test project's primary deployment, not SDG's
live website. Confirm the new project name before changing any setting.

Follow `docs/view-portal.md` for required environment variables and acceptance
gates. Do not mark personas ready or enable launch solely because hosting is
configured. The saved isolated secret key has not yet been verified: the sandbox
credential proxy fails certificate signature verification. No TLS checks were
disabled. The dashboard path does not itself resolve that verification gap.
