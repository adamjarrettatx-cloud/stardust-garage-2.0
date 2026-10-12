"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { request } from "@/app/components/time-clock/Shared";
import EmployeePortal from "@/app/employee/EmployeePortal";

// Staff picker + the real employee portal in read-only mode. Changing the
// person remounts the portal so no state carries over between people.
export default function EmployeeViewPreview({ enabled }) {
  const router = useRouter();
  const params = useSearchParams();
  const [workers, setWorkers] = useState(null);
  const [error, setError] = useState("");
  const chosen = params.get("worker") || "";

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const range = new URLSearchParams({ from: new Date(now - 86400000).toISOString(), to: new Date(now).toISOString() });
    request(`/api/admin/time-clock?${range}`)
      .then((d) => setWorkers(d.workers.filter((w) => w.active)))
      .catch((e) => setError(e.message));
  }, [enabled]);

  useEffect(() => {
    if (workers?.length && !workers.some((w) => w.id === chosen))
      router.replace(`/bananas/timekeeping/employee-view?worker=${workers[0].id}`);
  }, [workers, chosen, router]);

  const valid = workers?.some((w) => w.id === chosen);
  return (
    <div className="min-h-screen bg-[#0d0f0e]">
      <div className="emp-viewas-bar">
        <a href="/bananas/timekeeping">‹ Timekeeping</a>
        <label>
          <span>View as</span>
          <select value={valid ? chosen : ""} disabled={!workers?.length}
            onChange={(e) => router.replace(`/bananas/timekeeping/employee-view?worker=${e.target.value}`)}>
            {!workers && <option value="">Loading staff…</option>}
            {workers?.map((w) => (
              <option key={w.id} value={w.id}>{w.name}{w.login_enabled ? "" : " (no login yet)"}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="px-3 py-6 sm:px-8 sm:py-10">
        {error ? (
          <p className="emp-viewas-error" role="alert">{error}</p>
        ) : workers && !workers.length ? (
          <p className="emp-viewas-error">No active staff profiles yet. Add one in Timekeeping → Staff profiles.</p>
        ) : valid ? (
          <EmployeePortal key={chosen} enabled={enabled}
            viewAs={{ workerId: chosen, exitHref: "/bananas/timekeeping" }} />
        ) : null}
      </div>
    </div>
  );
}
