/**
 * The marketing landing is temporarily NOT the start page: `/` opens the
 * trainer for everyone (guests included). The landing itself is kept
 * intact and always reachable at `/landing`; to make it the signed-out
 * start page again, build with `VITE_LANDING_AS_HOME=true` — no code to
 * restore.
 */
export const LANDING_AS_HOME: boolean = import.meta.env.VITE_LANDING_AS_HOME === 'true';
