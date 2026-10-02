import http from "node:http";
import { readFile } from "node:fs/promises";
import {
  GET as kioskGet,
  POST as kioskPost,
} from "../../app/api/time-clock/[action]/route.js";
import {
  GET as ownerGet,
  POST as ownerPost,
} from "../../app/api/admin/time-clock/route.js";
import { initialize } from "./db.fixture.mjs";
import { requestContext } from "./owner.fixture.mjs";

if (process.env.NODE_ENV === "production")
  throw new Error("QA harness cannot run in production.");
process.env.TIME_CLOCK_ENABLED = "true";
process.env.TIME_CLOCK_SECRET = "LOCAL-TEST-ONLY-NO-PRODUCTION-SECRET-".repeat(
  3,
);
await initialize();
const dir = process.cwd() + "/.time-clock-qa";
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1:8090");
      if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(req.method === "POST" ? { body } : {}),
        });
        const response = await requestContext.run(
          { owner: req.headers.cookie?.includes("tc-qa-owner=local-test") },
          async () => {
            if (url.pathname === "/api/admin/time-clock")
              return req.method === "GET"
                ? ownerGet(request)
                : ownerPost(request);
            const action = url.pathname.split("/").at(-1),
              context = { params: Promise.resolve({ action }) };
            return req.method === "GET"
              ? kioskGet(request, context)
              : kioskPost(request, context);
          },
        );
        res.statusCode = response.status;
        for (const [key, value] of response.headers)
          if (key !== "set-cookie") res.setHeader(key, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("Set-Cookie", cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (url.pathname === "/logos/wordmark-white.svg") {
        res.setHeader("Content-Type", "image/svg+xml");
        res.end(
          await readFile(process.cwd() + "/public/logos/wordmark-white.svg"),
        );
        return;
      }
      if (url.pathname === "/app.js" || url.pathname === "/app.css") {
        res.setHeader(
          "Content-Type",
          url.pathname.endsWith("js") ? "text/javascript" : "text/css",
        );
        res.end(await readFile(dir + url.pathname));
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:#0d0f0e}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>',
      );
    } catch (e) {
      console.error(e.message);
      res.statusCode = 500;
      res.end("QA harness error");
    }
  })
  .listen(8090, "127.0.0.1", () =>
    console.log(
      "Isolated time-clock QA on http://127.0.0.1:8090; PIN 1234, pair 12345678. No external database.",
    ),
  );
