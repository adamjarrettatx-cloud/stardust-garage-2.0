// Starts the real new UI/API handlers against an isolated PostgreSQL engine.
// The ONLY stubs are Supabase transport and owner session resolution; their
// authorization boundaries are tested separately in tests/api/time-clock.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
const root = process.cwd(),
  dir = root + "/.time-clock-qa";
await mkdir(dir, { recursive: true });
await build({
  entryPoints: ["tests/time-clock/client.fixture.jsx"],
  bundle: true,
  outfile: dir + "/app.js",
  platform: "browser",
  jsx: "automatic",
  loader: { ".js": "jsx" },
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
});
await build({
  entryPoints: ["tests/time-clock/server.fixture.mjs"],
  bundle: true,
  outfile: dir + "/server.mjs",
  platform: "node",
  format: "esm",
  packages: "external",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  alias: {
    "@/lib/supabase/admin": root + "/tests/time-clock/db.fixture.mjs",
    "@/lib/auth-helpers": root + "/tests/time-clock/owner.fixture.mjs",
    "next/server": root + "/node_modules/next/server.js",
    "@": root,
  },
});
await import(dir + "/server.mjs");
