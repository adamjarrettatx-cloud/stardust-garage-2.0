// Server-only. Do not widen the global owner gate for this feature.
import { adminPageGate, requireAdminMfa } from "@/lib/auth-helpers";
import { canManageTimekeeping } from "./access.mjs";

export async function requireTimekeepingManager() {
  const auth = await requireAdminMfa();
  if (auth.unauthorized) return auth;
  if (
    !canManageTimekeeping({ email: auth.user?.email, isAdmin: auth.isAdmin })
  ) {
    return {
      unauthorized: true,
      user: null,
      reason: "not_timekeeping_manager",
    };
  }
  return auth;
}

export async function timekeepingPageGate() {
  const auth = await adminPageGate();
  if (auth.redirect) return auth;
  return canManageTimekeeping({
    email: auth.user?.email,
    isAdmin: auth.isAdmin,
  })
    ? auth
    : { user: null, redirect: "/bananas" };
}
