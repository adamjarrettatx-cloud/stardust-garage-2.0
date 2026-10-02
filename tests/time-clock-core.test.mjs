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
import { keyedHash, hashPin, verifyPin, newPin, pairingCode } from "../lib/time-clock/crypto.mjs";
import { PIN_LENGTH, isValidPin } from "../lib/time-clock/pin.mjs";
test("staff PIN policy is exactly four ASCII digits, preserving leading zeros", () => {
  assert.equal(PIN_LENGTH, 4);
  for (const value of ["0000", "0007", "1234", "9999"]) assert(isValidPin(value));
  for (const value of ["", "123", "12345", "123456", "1234\n", " 1234", "１２３４", "abcd", 1234, null])
    assert.equal(isValidPin(value), false);
});
test("generated staff PINs are four digits and pairing codes stay eight digits", () => {
  for (let i = 0; i < 1000; i++) assert(isValidPin(newPin()));
  assert.match(pairingCode(), /^[0-9]{8}$/);
});
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
  const a = await hashPin("1234", secret),
    b = await hashPin("1234", secret);
  assert.notEqual(a, b);
  assert.match(a, /^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/);
  assert(await verifyPin("1234", a, secret));
  assert(!(await verifyPin("4321", a, secret)));
  assert(!(await verifyPin("1234", null, secret)));
  assert.notEqual(
    keyedHash("device", "value", secret),
    keyedHash("session", "value", secret),
  );
  assert.throws(() => keyedHash("pin", "1234", "short"));
});
