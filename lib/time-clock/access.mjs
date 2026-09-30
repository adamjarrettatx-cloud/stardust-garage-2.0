// Presentation predicate and server authorization share the same narrow scope.
// The server must supply isAdmin from team_members, never user metadata.
export function canManageTimekeeping({ email, isAdmin = false } = {}) {
  return (
    isAdmin === true &&
    typeof email === "string" &&
    ["adam@sdgatx.com", "jeyu@sdgatx.com"].includes(email.toLowerCase())
  );
}
