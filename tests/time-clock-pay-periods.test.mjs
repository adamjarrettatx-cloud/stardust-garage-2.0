import test from "node:test";
import assert from "node:assert/strict";
import { payPeriodAt, payPeriodEnd, payPeriodLabel, payPeriodStart } from "../lib/time-clock/periods.mjs";

test("pay periods are two weeks from Monday 2026-09-28", () => {
  assert.equal(payPeriodStart("2026-09-28"), "2026-09-28");
  assert.equal(payPeriodStart("2026-10-11"), "2026-09-28");
  assert.equal(payPeriodStart("2026-10-12"), "2026-10-12");
  assert.equal(payPeriodStart("2026-10-25"), "2026-10-12");
  assert.equal(payPeriodStart("2026-10-26"), "2026-10-26");
  assert.equal(payPeriodStart("2026-09-27"), "2026-09-14");
  assert.equal(payPeriodEnd("2026-10-12"), "2026-10-25");
});

test("prior pay period and labels", () => {
  assert.deepEqual(payPeriodAt("2026-10-13", -1), { start: "2026-09-28", end: "2026-10-11" });
  assert.deepEqual(payPeriodAt("2026-10-13", 0), { start: "2026-10-12", end: "2026-10-25" });
  assert.equal(payPeriodLabel("2026-10-12"), "Oct 12 – Oct 25");
  assert.equal(payPeriodLabel("2026-12-21"), "Dec 21, 2026 – Jan 3, 2027");
});
