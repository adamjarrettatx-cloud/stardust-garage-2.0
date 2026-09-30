import { AsyncLocalStorage } from "node:async_hooks";
export const requestContext = new AsyncLocalStorage();
export async function requireOwnerMfa() {
  return requestContext.getStore()?.owner
    ? {
        user: { id: "11111111-1111-4111-8111-111111111111" },
        unauthorized: false,
      }
    : { unauthorized: true, reason: "not_owner" };
}
