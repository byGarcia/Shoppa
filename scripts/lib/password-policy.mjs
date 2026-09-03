/**
 * The minimum password length, and nothing else.
 *
 * A module of its own because it has to be readable from three places that
 * cannot share code any other way:
 *
 *  - `password.mjs`, which enforces it, and which the container runs with plain
 *    `node` from `scripts/lib` — so it cannot live under `src/`;
 *  - the API routes, which reject a short password before hashing it;
 *  - the two entry forms, which are client components. They cannot import
 *    `password.mjs` itself: it opens with `node:crypto`, which has no business
 *    in a browser bundle. Nothing here imports anything, so this file is safe
 *    everywhere.
 *
 * Before this existed the number `12` was written in four places, and the claim
 * that raising it meant one edit was simply false.
 */
export const MIN_PASSWORD_LENGTH = 12;
