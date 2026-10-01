import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";

// Render the actual shared frame inside the real authenticated provider.
// Server rendering catches a disconnected default without a browser or DB.
async function renderFrame(owner) {
  const result = await build({
    stdin: {
      contents: `
        import React from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import Provider from "./app/components/AuthenticatedThemeProvider";
        import { Frame } from "./app/components/time-clock/Shared";
        export const html = renderToStaticMarkup(
          <Provider scope="admin"><Frame owner={${owner}}>Test</Frame></Provider>
        );
      `,
      resolveDir: process.cwd(),
      loader: "jsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    alias: { "@": process.cwd() },
    loader: { ".js": "jsx", ".css": "empty" },
  });
  // Import beside node_modules so external React dependencies resolve.
  const file = new URL(`../.time-clock-theme-${owner}.mjs`, import.meta.url);
  fs.writeFileSync(file, result.outputFiles[0].text);
  try {
    return (await import(file.href)).html;
  } finally {
    fs.unlinkSync(file);
  }
}

test("embedded timekeeping has no competing theme toggle", async () => {
  const html = await renderFrame(true);
  assert.match(html, /tc-root tc-owner/);
  assert.doesNotMatch(html, /Toggle timekeeping theme|Toggle light and dark theme/);
});

test("standalone kiosk retains its independent appearance control", async () => {
  const html = await renderFrame(false);
  assert.match(html, /Toggle light and dark theme/);
  assert.match(html, /data-theme="dark"/);
});
