// True only on the isolated View Portal test site. Used to keep actions that
// would notify a real person (such as sending a date pitch) view-only there.
export function isViewPortalSandbox(env = process.env) {
  return env.VIEW_PORTAL_MODE === 'sandbox';
}
export const PREVIEW_ONLY_MESSAGE = 'View Portal preview. Pitches can’t be sent or withdrawn here.';
