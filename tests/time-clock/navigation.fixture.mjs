// Browser-only stand-in for next/navigation in the local QA harness.
import { useEffect, useState } from "react";
const listeners = new Set();
export function useRouter() {
  return {
    replace(href) { history.replaceState(null, "", href.replace("/bananas/timekeeping/employee-view", "/owner/employee-view")); listeners.forEach((f) => f()); },
    push(href) { this.replace(href); },
  };
}
export function useSearchParams() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => listeners.delete(f); }, []);
  return new URLSearchParams(location.search);
}
