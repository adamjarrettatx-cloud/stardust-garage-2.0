"use client";

import { useState } from "react";
import Link from "next/link";
import Wordmark from "@/app/components/Wordmark";

export default function EmployeeLogin() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/employee/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sign-in failed.");
      setPassword("");
      window.location.replace(data.destination || "/employee");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  const input =
    "w-full rounded-xl border border-white/20 bg-[#141414] px-4 py-3 text-base text-white outline-none focus:border-white";
  return (
    <main className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-8">
          <Wordmark size="md" align="center" />
        </div>
        <h1 className="text-2xl font-bold text-center mb-3">Employee sign in</h1>
        <p className="text-sm text-[#aaa] text-center mb-8">View your schedule, hours and pay.</p>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="employee-identifier" className="block text-sm font-semibold mb-2">
              Username or email
            </label>
            <input id="employee-identifier" name="username" autoComplete="username" autoCapitalize="none"
              spellCheck={false} maxLength={254} value={identifier} onChange={(e) => setIdentifier(e.target.value)}
              required className={input} disabled={busy} />
          </div>
          <div>
            <label htmlFor="employee-password" className="block text-sm font-semibold mb-2">Password</label>
            <input id="employee-password" name="password" type="password" autoComplete="current-password"
              maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required
              className={input} disabled={busy} />
          </div>
          {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full rounded-full bg-white text-black py-3.5 font-semibold disabled:opacity-50">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-sm text-[#aaa]">
          Need access or a password reset? Ask a manager. If you signed up with an email, you can also use{" "}
          <Link href="/forgot-password" className="underline">Forgot password</Link>.
        </p>
      </div>
    </main>
  );
}
