// Server-only. Do not widen the global owner gate for this feature.
import { adminPageGate, requireAdminMfa } from "@/lib/auth-helpers";
import { canManageStaff } from "./access.mjs";

export async function requireStaffManager() {
  const auth = await requireAdminMfa();
  if (auth.unauthorized) return auth;
  if (
    !canManageStaff({ email: auth.user?.email, isAdmin: auth.isAdmin })
  ) {
    return {
      unauthorized: true,
      user: null,
      reason: "not_staff_manager",
    };
  }
  return auth;
}

export async function staffPageGate() {
  const auth = await adminPageGate();
  if (auth.redirect) return auth;
  return canManageStaff({
    email: auth.user?.email,
    isAdmin: auth.isAdmin,
  })
    ? auth
    : { user: null, redirect: "/bananas" };
}
