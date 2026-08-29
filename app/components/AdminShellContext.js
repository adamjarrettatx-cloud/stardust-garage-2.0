'use client';

import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// "Am I inside the admin shell?"
// ---------------------------------------------------------------------------
// The /team pages (Tasks, Team Calendar, Team Chat) are reachable two ways:
// from the admin sidebar, where the shell supplies the page container, the
// header and a breadcrumb — and directly by a non-admin team member, who never
// sees the admin sidebar at all and still needs the page's own chrome.
//
// Whether the shell is present is decided at render time from the pathname and
// the viewer's role, so it cannot be passed down as a server prop without
// threading it through every page. A context lets each client component ask
// directly and drop its own container and back link only when something else
// is already providing them.
const AdminShellContext = createContext(false);

export function AdminShellProvider({ children }) {
  return (
    <AdminShellContext.Provider value>{children}</AdminShellContext.Provider>
  );
}

// True only when an ancestor admin shell is rendering the surrounding chrome.
// Defaults to false, so a page rendered on its own keeps its own chrome.
export function useInAdminShell() {
  return useContext(AdminShellContext);
}

export default AdminShellContext;
