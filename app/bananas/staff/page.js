import { redirect } from "next/navigation";
import { staffPageGate } from "@/lib/time-clock/auth";
import { enabled } from "@/lib/time-clock/server";
import Staff from "./Staff";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Staff | Stardust Garage",
  robots: { index: false, follow: false },
};
export default async function StaffPage() {
  const { redirect: gate } = await staffPageGate();
  if (gate) redirect(gate);
  return <Staff enabled={enabled()} />;
}
