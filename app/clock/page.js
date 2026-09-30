import Kiosk from "./Kiosk";
import { enabled } from "@/lib/time-clock/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Staff Time Clock | Stardust Garage",
  robots: { index: false, follow: false },
};
export default function ClockPage() {
  return <Kiosk enabled={enabled()} />;
}
