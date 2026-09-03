// Hand-written types for the plain-ESM helper. `db.mjs` lives outside `src/` so
// that the container can import it with plain `node` (see the file's own
// header); TypeScript callers get the contract from here.
import type { Client } from "pg";

/**
 * Opens a connection from `DATABASE_URL`. Throws when the variable is missing.
 * The caller closes it with `end()`.
 */
export declare function getClient(): Promise<Client>;
