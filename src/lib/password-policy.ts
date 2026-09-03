// The minimum lives in `scripts/lib/password-policy.mjs`, not here — same
// arrangement as `src/lib/password.ts`, and for the same reason: the container
// runs the seed and the password rescue with plain `node`, where nothing under
// `src/` exists.
//
// This module exists separately from `src/lib/password.ts` because the two
// entry forms are client components. `src/lib/password.ts` re-exports a module
// that opens with `node:crypto`, which must not reach a browser bundle; this
// one re-exports a file that imports nothing at all.
export { MIN_PASSWORD_LENGTH } from "../../scripts/lib/password-policy.mjs";
