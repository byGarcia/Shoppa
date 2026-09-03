// Hand-written types for the plain-ESM rescue script. It lives outside `src/`
// and stays plain ESM because it runs inside the container with plain `node`
// (see the file's own header); TypeScript callers — today only its test — get
// the contract from here.
import type { Client } from "pg";

/**
 * The same rule as `normalizeEmail` in src/lib/email.ts, which this script
 * cannot import. The test pins the two together.
 */
export declare function normalizeEmail(raw: string): string;

/**
 * Takes one edited line off the front of raw terminal input, applying
 * backspaces and dropping control characters. `rest` is what followed the
 * newline and belongs to the next prompt.
 */
export declare function readLineFrom(raw: string): {
  status: "line" | "incomplete" | "cancelled";
  value: string;
  rest: string;
};

/** The account a rescue is about to overwrite, or null if there is none. */
export declare function findAccount(
  client: Client,
  email: string,
): Promise<{ id: string; email: string; hasPassword: boolean; passkeys: number } | null>;

/**
 * Hashes `plain` and writes it together with `token_version + 1` and the
 * normalised spelling of the address, in one statement. Normalises the argument
 * itself. Resolves to null when no row matched; throws when the password is
 * shorter than the minimum, before touching the database.
 *
 * `audited` says whether the `PASSWORD_RESET` row landed in `security_logs`.
 * It is best effort by design: a failed audit never undoes a rescue.
 */
export declare function resetPassword(
  client: Client,
  rawEmail: string,
  plain: string,
): Promise<{ email: string; tokenVersion: number; audited: boolean } | null>;
