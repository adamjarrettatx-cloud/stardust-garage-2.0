import React from "react";
import { createRoot } from "react-dom/client";
import Kiosk from "../../app/clock/Kiosk";
import Timekeeping from "../../app/bananas/timekeeping/Timekeeping";
import AuthenticatedThemeProvider, {
  useAuthenticatedTheme,
} from "../../app/components/AuthenticatedThemeProvider";

function OwnerPreview() {
  const { theme, toggleTheme } = useAuthenticatedTheme();
  return (
    <div style={{ background: "var(--auth-panel-bg)", color: "var(--auth-text)", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <h1>Admin</h1>
        <button onClick={toggleTheme} aria-label="Toggle admin theme">
          {theme === "light" ? "Switch to dark" : "Switch to light"}
        </button>
      </header>
      <Timekeeping enabled />
    </div>
  );
}

createRoot(document.getElementById("app")).render(
  location.pathname === "/owner" ? (
    <AuthenticatedThemeProvider scope="admin">
      <OwnerPreview />
    </AuthenticatedThemeProvider>
  ) : <Kiosk enabled />,
);
