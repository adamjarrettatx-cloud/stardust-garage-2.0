import { redirect } from "next/navigation";
import { ownerPageGate } from "@/lib/auth-helpers";
import { enabled } from "@/lib/time-clock/server";
import Timekeeping from "./Timekeeping";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Timekeeping | Stardust Garage",
  robots: { index: false, follow: false },
};
export default async function TimekeepingPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);
  return <Timekeeping enabled={enabled()} />;
}
