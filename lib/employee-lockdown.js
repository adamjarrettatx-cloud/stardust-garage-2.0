// Employee-only accounts (staff-portal logins) may use the employee portal and
// nothing else on the website. Edge-safe: no Node APIs.
//
// The decision reads `app_metadata.employee_account` from the SIGNED Supabase
// access token in the request (cookie or bearer). The token is not verified
// here, and that is deliberate and safe: this check can only ADD restrictions.
// Removing the claim would break the signature, and every downstream route
// verifies the token with Supabase before granting anything.

const EMPLOYEE_ALLOWED = [
  /^\/employee(\/|$)/,
  /^\/api\/employee(\/|$)/,
  // Sign-in, sign-out and password recovery.
  /^\/login$/,
  /^\/auth(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/forgot-password$/,
  /^\/reset-password$/,
  // Legal pages and client error reporting.
  /^\/(privacy|terms|legal)(\/|$)/,
  /^\/api\/client-error$/,
  // The shared iPad kiosk uses its own device credential, never this session.
  /^\/clock$/,
  /^\/api\/time-clock(\/|$)/,
  // Owner View Portal handoff and exit (exist only on the isolated preview host).
  /^\/view-preview\/(redeem|exit)$/,
  // Framework and static assets.
  /^\/_next\//,
  /^\/[^?#]*\.[a-z0-9]{2,5}$/i,
];

export function employeeAllowedPath(pathname) {
  return EMPLOYEE_ALLOWED.some((re) => re.test(pathname));
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function jwtClaims(token) {
  try {
    const part = typeof token === "string" ? token.split(".")[1] : null;
    return part ? JSON.parse(decodeBase64Url(part)) : null;
  } catch {
    return null;
  }
}

// @supabase/ssr stores the session as `sb-<ref>-auth-token`, optionally split
// into `.0`, `.1`, ... chunks and optionally prefixed with `base64-`.
export function sessionAccessToken(cookies) {
  const groups = new Map();
  for (const { name, value } of cookies) {
    const m = /^(sb-[A-Za-z0-9_-]+-auth-token)(?:\.(\d+))?$/.exec(name);
    if (!m) continue;
    if (!groups.has(m[1])) groups.set(m[1], []);
    groups.get(m[1]).push([m[2] === undefined ? -1 : Number(m[2]), value]);
  }
  for (const parts of groups.values()) {
    const raw = parts.sort((a, b) => a[0] - b[0]).map(([, v]) => v).join("");
    try {
      let text = decodeURIComponent(raw);
      if (text.startsWith("base64-")) text = decodeBase64Url(text.slice(7));
      const parsed = JSON.parse(text);
      const token = Array.isArray(parsed) ? parsed[0] : parsed?.access_token;
      if (typeof token === "string") return token;
    } catch {
      /* Not a readable session cookie; ignore. */
    }
  }
  return null;
}

export function isEmployeeOnlyRequest(request) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  const tokens = [bearer, sessionAccessToken(request.cookies.getAll())].filter(Boolean);
  return tokens.some((t) => jwtClaims(t)?.app_metadata?.employee_account === true);
}

// Middleware result for an employee-only session, or null to continue.
export function employeeLockdown(request, NextResponse) {
  const { pathname } = request.nextUrl;
  if (employeeAllowedPath(pathname) || !isEmployeeOnlyRequest(request)) return null;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Employee accounts can only use the employee portal.", code: "employee_only" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const url = request.nextUrl.clone();
  url.pathname = "/employee";
  url.search = "";
  return NextResponse.redirect(url);
}
