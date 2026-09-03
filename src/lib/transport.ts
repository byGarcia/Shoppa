import { isSecureOrigin } from "./env";

/**
 * Cookie and transport decisions come from APP_ORIGIN, never from NODE_ENV.
 *
 * `__Secure-` and `secure: true` are refused outright by browsers over plain
 * HTTP, so deriving them from the build mode is what makes a LAN deployment
 * look broken: the login succeeds, the cookie is dropped, nothing happens.
 */
export function sessionCookieName(): string {
  return isSecureOrigin() ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/**
 * HSTS lives here rather than in next.config.ts because `headers()` is resolved
 * during `next build` — it is baked into .next/routes-manifest.json — and
 * next.config.ts is not copied into the runner image. A runtime variable cannot
 * reach it there.
 */
export function hstsHeader(): string | null {
  return isSecureOrigin() ? "max-age=63072000; includeSubDomains; preload" : null;
}
