import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { enabled } from "@/lib/time-clock/server";
import EmployeePortal from "./EmployeePortal";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "My Schedule | Stardust Garage",
  robots: { index: false, follow: false },
};

// Data is loaded from /api/employee/me, which re-verifies the signed-in user
// and returns only that user's linked staff profile.
export default async function EmployeePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data?.user || data.user.app_metadata?.station_account) redirect("/employee/login");
  return (
    <div className="min-h-screen bg-[#0d0f0e] px-3 py-6 sm:px-8 sm:py-10">
      <EmployeePortal enabled={enabled()} />
    </div>
  );
}
