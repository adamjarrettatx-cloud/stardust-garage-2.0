#!/usr/bin/env node
// scripts/seed-waiver.mjs
//
// Idempotent seed: pushes every version in lib/waiver/versions.js into
// public.waiver_versions, deactivates prior active rows of the same kind,
// and refuses to run if a slug already exists with a different body hash.
//
// Run:
//   node scripts/seed-waiver.mjs
// Env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Resolve lib/waiver/versions.js relative to repo root (this file lives in scripts/).
const versionsUrl = pathToFileURL(
  path.resolve(new URL(".", import.meta.url).pathname, "..", "lib", "waiver", "versions.js")
).href;
const { WAIVER_VERSIONS, hashBody } = await import(versionsUrl);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE env vars.");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  for (const v of WAIVER_VERSIONS) {
    const bodyHash = hashBody(v.bodyMarkdown);

    const { data: existing, error: exErr } = await supabase
      .from("waiver_versions")
      .select("id, body_sha256, is_active, kind")
      .eq("slug", v.slug)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing) {
      if (existing.body_sha256 !== bodyHash) {
        throw new Error(
          `Refusing to seed: slug=${v.slug} exists with different body hash. Bump the slug/version instead.`
        );
      }
      // Sync active flag if needed
      if (existing.is_active !== v.active) {
        const { error } = await supabase
          .from("waiver_versions")
          .update({ is_active: v.active })
          .eq("id", existing.id);
        if (error) throw error;
        console.log(`updated is_active for slug=${v.slug} -> ${v.active}`);
      } else {
        console.log(`ok: slug=${v.slug} already seeded`);
      }
      continue;
    }

    // New version — insert, and if active, deactivate any prior active of same kind.
    if (v.active) {
      const { error: deErr } = await supabase
        .from("waiver_versions")
        .update({ is_active: false })
        .eq("kind", v.kind)
        .eq("is_active", true);
      if (deErr) throw deErr;
    }

    const { error: insErr } = await supabase.from("waiver_versions").insert({
      slug: v.slug,
      version: v.version,
      kind: v.kind,
      effective_at: v.effectiveAt,
      checkbox_label: v.checkboxLabel,
      body_markdown: v.bodyMarkdown,
      body_sha256: bodyHash,
      is_active: v.active,
    });
    if (insErr) throw insErr;
    console.log(`inserted slug=${v.slug} version=${v.version} active=${v.active}`);
  }
  console.log("waiver seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
