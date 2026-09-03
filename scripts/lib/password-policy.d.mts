// Hand-written types for the plain-ESM constant. It lives outside `src/` so the
// container can import it with plain `node` (see the file's own header), and it
// imports nothing so that client components can import it too.

/** The minimum length `hashPassword` accepts, and every caller enforces. */
export declare const MIN_PASSWORD_LENGTH: 12;
