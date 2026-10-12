import { Suspense } from "react";
import { redirect } from "next/navigation";
import { timekeepingPageGate } from "@/lib/time-clock/auth";
import { enabled } from "@/lib/time-clock/server";
import EmployeeViewPreview from "./EmployeeViewPreview";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "View as employee | Stardust Garage",
  robots: { index: false, follow: false },
};

// Manager-only read-only preview of the employee portal. Data comes from
// /api/admin/time-clock/employee-preview, which repeats the manager check.
export default async function EmployeeViewPage() {
  const { redirect: gate } = await timekeepingPageGate();
  if (gate) redirect(gate);
  return (
    <Suspense fallback={null}>
      <EmployeeViewPreview enabled={enabled()} />
    </Suspense>
  );
}
