import { redirect } from "next/navigation";
import { timekeepingPageGate } from "@/lib/time-clock/auth";
import { enabled } from "@/lib/time-clock/server";
import Timekeeping from "./Timekeeping";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Timekeeping | Stardust Garage",
  robots: { index: false, follow: false },
};
export default async function TimekeepingPage() {
  const { redirect: gate } = await timekeepingPageGate();
  if (gate) redirect(gate);
  return <Timekeeping enabled={enabled()} />;
}
