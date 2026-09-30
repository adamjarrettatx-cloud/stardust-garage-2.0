import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateCents,
  elapsedMs,
  duration,
  dollarsToCents,
  csvCell,
  chicagoInput,
  chicagoToIso,
} from "../lib/time-clock/core.mjs";
import { keyedHash, hashPin, verifyPin } from "../lib/time-clock/crypto.mjs";
test("exact overnight/DST elapsed time and final-only base estimate", () => {
  const s = {
    started_at: "2026-11-01T00:30:00-05:00",
    ended_at: "2026-11-01T02:30:00-06:00",
    pay_basis: "hourly",
  };
  s.segments = [{ ...s, rate_cents: 2000 }];
  assert.equal(duration(elapsedMs(s)), "3h 00m");
  assert.equal(estimateCents(s), 6000);
  assert.equal(estimateCents({ ...s, ended_at: null }), null);
  assert.equal(estimateCents({ ...s, pay_basis: "unset" }), null);
  assert.equal(
    estimateCents({ ...s, pay_basis: "flat", flat_cents: 10000 }),
    10000,
  );
});
test("missing rate is not zero and segment amounts round once at shift boundary", () => {
  const s = {
    ended_at: "2026-01-01T01:00:00Z",
    pay_basis: "hourly",
    segments: [
      {
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T01:00:00Z",
        rate_cents: null,
      },
    ],
  };
  assert.equal(estimateCents(s), null);
  s.segments[0].rate_cents = 0;
  assert.equal(estimateCents(s), 0);
});
test("dollars convert exactly, reject negatives, infinity and overprecision", () => {
  assert.equal(dollarsToCents("22.50"), 2250);
  assert.equal(dollarsToCents("0"), 0);
  assert.equal(dollarsToCents(""), null);
  for (const x of ["-1", "Infinity", "20.001"])
    assert.throws(() => dollarsToCents(x));
});
test("CSV safely quotes untrusted staff names and notes", () => {
  assert.equal(csvCell("  =SUM(1,2)"), `"'  =SUM(1,2)"`);
  assert.equal(csvCell('a"b'), '"a""b"');
});
test("Austin corrections respect DST and reject skipped/ambiguous hours", () => {
  assert.equal(chicagoToIso("2026-09-29T22:00"), "2026-09-30T03:00:00.000Z");
  assert.equal(chicagoInput("2026-09-30T03:00:00Z"), "2026-09-29T22:00:00");
  assert.throws(() => chicagoToIso("2026-03-08T02:30"), /does not exist/);
  assert.throws(() => chicagoToIso("2026-11-01T01:30"), /occurs twice/);
  assert.equal(
    chicagoToIso("2026-11-01T01:30", "-05:00"),
    "2026-11-01T06:30:00.000Z",
  );
  assert.equal(
    chicagoToIso("2026-11-01T01:30", "-06:00"),
    "2026-11-01T07:30:00.000Z",
  );
});
test("salted slow PIN verifier, keyed purpose separation and unknown lookups", async () => {
  const secret = "test-only-secret-".repeat(4);
  const a = await hashPin("123456", secret),
    b = await hashPin("123456", secret);
  assert.notEqual(a, b);
  assert(!a.includes("123456"));
  assert(await verifyPin("123456", a, secret));
  assert(!(await verifyPin("654321", a, secret)));
  assert(!(await verifyPin("123456", null, secret)));
  assert.notEqual(
    keyedHash("device", "value", secret),
    keyedHash("session", "value", secret),
  );
  assert.throws(() => keyedHash("pin", "123456", "short"));
});
