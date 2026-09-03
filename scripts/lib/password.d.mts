// Hand-written types for the plain-ESM implementation. `password.mjs` lives
// outside `src/` so that the container can import it with plain `node` (see the
// file's own header); TypeScript callers get the contract from here.

/**
 * Incremented by every key derivation. Exported for the tests: it is the only
 * falsifiable proof that `burnDummyHash` is not a no-op.
 */
export declare let DERIVATION_COUNT: number;

/** Minimum length accepted by `hashPassword`. */
export declare const MIN_PASSWORD_LENGTH: 12;

/** Returns `scrypt$N=65536,r=8,p=1$<salt b64>$<key b64>`. */
export declare function hashPassword(plain: string): Promise<string>;

/**
 * False for a wrong password, for a null or non-string `stored`, for any
 * malformed hash and for parameters outside the accepted envelope. Never
 * throws.
 */
export declare function verifyPassword(plain: string, stored: string): Promise<boolean>;

/** Burns one derivation so a missing account costs what a wrong password costs. */
export declare function burnDummyHash(): Promise<void>;
