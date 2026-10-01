"use client";

import { useState } from "react";
import { useOptionalAuthenticatedTheme } from "@/app/components/AuthenticatedThemeProvider";
import { duration, elapsedMs, estimateCents } from "@/lib/time-clock/core.mjs";
import "./time-clock.css";

export const time = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
export const date = (value) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
export const money = (cents) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
export async function request(path, payload, signal) {
  const response = await fetch(path, {
    method: payload ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error || "Request failed. No success has been confirmed.",
    );
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
export function Frame({ children, owner = false }) {
  const authenticatedTheme = useOptionalAuthenticatedTheme();
  const [kioskTheme, setKioskTheme] = useState("dark");
  // Embedded timekeeping follows the surrounding Admin setting. Only the
  // standalone kiosk owns a separate appearance control.
  const theme = owner ? (authenticatedTheme?.theme ?? "dark") : kioskTheme;
  return (
    <div className={`tc-root ${owner ? "tc-owner" : ""}`} data-theme={theme}>
      {!owner && (
        <header>
          <div className="brand">
            {/* Existing approved wordmark, unchanged. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/wordmark-white.svg"
              width="112"
              height="42"
              alt="Stardust Garage"
            />
            <span className="brandline" />
            <span>STAFF HUB</span>
          </div>
          <nav aria-label="Kiosk appearance">
            <span className="sub">Time clock</span>
            <button
              type="button"
              className="theme"
              aria-label="Toggle light and dark theme"
              onClick={() => setKioskTheme(theme === "dark" ? "light" : "dark")}
            >
              ◐
            </button>
          </nav>
        </header>
      )}
      <main>{children}</main>
      {!owner && (
        <footer>
          <span>STARDUST GARAGE / AUSTIN, TX</span>
          <span>Front room · Shared time clock</span>
        </footer>
      )}
    </div>
  );
}
export function ShiftTable({
  shifts,
  owner = false,
  onView,
  now = Date.now(),
}) {
  if (!shifts.length)
    return (
      <div className="empty panel">
        <h2>No matching shifts</h2>
        <p>
          Completed shifts will appear here. Try another date or status filter.
        </p>
      </div>
    );
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            {owner && <th>Team member</th>}
            <th>Role / date</th>
            <th>Clock in → out</th>
            <th>Time</th>
            {owner && <th>Base estimate</th>}
            <th>Status</th>
            {owner && <th>Review</th>}
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => (
            <tr key={s.id}>
              {owner && (
                <td>
                  <strong>{s.worker_name}</strong>
                  <span className="cellsub">{s.category}</span>
                </td>
              )}
              <td>
                {[...new Set(s.segments.map((g) => g.role_name))].join(" / ")}
                <span className="cellsub">{date(s.started_at)}</span>
              </td>
              <td>
                {time(s.started_at)} → {s.ended_at ? time(s.ended_at) : "Open"}
                {s.ended_at && date(s.started_at) !== date(s.ended_at) && (
                  <span className="cellsub">Ends {date(s.ended_at)}</span>
                )}
              </td>
              <td className="mono">{duration(elapsedMs(s, now))}</td>
              {owner && (
                <td>
                  {estimateCents(s) === null
                    ? s.ended_at
                      ? "Rate not set"
                      : "Not final"
                    : money(estimateCents(s))}
                  <span className="cellsub">
                    {s.pay_basis === "flat"
                      ? "Flat shift fee"
                      : "Not final payroll"}
                  </span>
                </td>
              )}
              <td>
                <Status shift={s} />
              </td>
              {owner && (
                <td>
                  <button type="button" onClick={() => onView(s.id)}>
                    View
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Status({ shift }) {
  const open = !shift.ended_at,
    paused = shift.breaks?.some((b) => !b.ended_at);
  return (
    <span
      className={`pill ${open ? "live" : shift.status === "pending" ? "warning" : ""}`}
    >
      {open
        ? paused
          ? "On break"
          : "On shift"
        : shift.status === "approved"
          ? "Approved"
          : "Needs review"}
    </span>
  );
}
