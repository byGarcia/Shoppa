/**
 * The single spelling rule for an address.
 *
 * Addresses enter this application from three doors — the password branch, the
 * WebAuthn options endpoint and the assertion verifier — and until first-run
 * registration existed there was nothing that *wrote* one, so no convention had
 * been settled and the three doors disagreed: the password lookup normalised,
 * the two WebAuthn lookups used the raw string. `Ana@example.com` would have
 * signed in with a password and failed with a passkey.
 *
 * Registration (src/server/setup.ts) stores the normalised form, so every
 * lookup must normalise with this same function. One definition, imported;
 * an inline `.trim().toLowerCase()` at each call site is the same rule written
 * four times, and four is how many chances there are to forget it.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
