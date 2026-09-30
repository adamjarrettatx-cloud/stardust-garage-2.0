import React from "react";
import { createRoot } from "react-dom/client";
import Kiosk from "../../app/clock/Kiosk";
import Timekeeping from "../../app/bananas/timekeeping/Timekeeping";
createRoot(document.getElementById("app")).render(
  location.pathname === "/owner" ? <Timekeeping enabled /> : <Kiosk enabled />,
);
