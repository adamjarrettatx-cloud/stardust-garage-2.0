import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage();
export async function requireAdminMfa() {
  return requestContext.getStore()?.owner
    ? {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "adam@sdgatx.com",
        },
        isAdmin: true,
        unauthorized: false,
      }
    : { unauthorized: true, reason: "not_owner" };
}
export async function adminPageGate() {
  const auth = await requireAdminMfa();
  return { ...auth, redirect: auth.unauthorized ? "/login" : null };
}
export async function getRequestUser() {
  return requestContext.getStore()?.employee
    ? { id: "33333333-3333-4333-8333-333333333333", email: "jordan@example.test" }
    : null;
}
