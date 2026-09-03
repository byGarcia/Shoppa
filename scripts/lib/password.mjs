import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { MIN_PASSWORD_LENGTH } from "./password-policy.mjs";

const scrypt = promisify(scryptCallback);

/**
 * Password hashing with scrypt from the Node standard library.
 *
 * Not argon2 and not bcrypt: both are native bindings, and their compilation is
 * what fails on a Raspberry Pi or an ARM NAS — half the audience for a
 * self-hosted application. scrypt is memory-hard and OWASP accepts it where
 * argon2id is unavailable.
 *
 * `maxmem` is NOT optional. Node's default ceiling is 32 MiB and these
 * parameters need roughly 64 MiB, so without it every call throws
 * ERR_CRYPTO_INVALID_SCRYPT_PARAMS. Measured on Node 26.7.0: 167 ms.
 *
 * Plain ESM rather than TypeScript, and outside `src/`, because the runner
 * image copies only `src/entorno.ts` from `src`, and plain `node` does not
 * resolve the `@/` alias. The rescue script and the seed run inside that image
 * and need this exact code; `src/lib/password.ts` re-exports it so the
 * application and the tests share the one implementation.
 */
const PARAMS = { N: 65536, r: 8, p: 1 };
const MAXMEM = 128 * 1024 * 1024;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Imported rather than declared here so that the client components, which
// cannot pull `node:crypto` into a browser bundle, read the same number.
// Re-exported so the existing callers of `@/lib/password` do not have to move.
export { MIN_PASSWORD_LENGTH };

/**
 * Incremented by every key derivation, exported for the tests. It is the only
 * way to prove `burnDummyHash` is not a no-op: asserting that it resolves to
 * `undefined` is satisfied by an empty function, which is precisely the
 * regression that reopens email enumeration in the login.
 *
 * @type {number}
 */
export let DERIVATION_COUNT = 0;

/**
 * @param {{ N: number, r: number, p: number }} params
 * @returns {string}
 */
function formatParams(params) {
  return `N=${params.N},r=${params.r},p=${params.p}`;
}

// scrypt's cost is proportional to N*r*p, but `maxmem` only bounds
// 128*r*(N+2) + 128*r*p — the memory axis. `p` is cheap in memory and
// expensive in CPU, so a stored value of p=1015000 sails through the maxmem
// gate and then derives for hours on a libuv threadpool thread, of which
// there are four. Reading parameters from the string is the point of the
// format; accepting *any* parameters from it is not.
const LIMITS = { N: 1 << 20, r: 32, p: 16 };

/**
 * @param {string} raw
 * @returns {{ N: number, r: number, p: number } | null}
 */
function parseParams(raw) {
  /** @type {Record<string, number>} */
  const found = {};
  for (const pair of raw.split(",")) {
    const [key, value] = pair.split("=");
    const parsed = Number(value);
    if (!key || !Number.isInteger(parsed) || parsed <= 0) return null;
    found[key] = parsed;
  }
  if (found.N === undefined || found.r === undefined || found.p === undefined) return null;
  if (found.N > LIMITS.N || found.r > LIMITS.r || found.p > LIMITS.p) return null;
  if ((found.N & (found.N - 1)) !== 0) return null; // scrypt requires a power of two
  return { N: found.N, r: found.r, p: found.p };
}

/**
 * @param {string} plain
 * @param {Buffer} salt
 * @param {{ N: number, r: number, p: number }} params
 * @returns {Promise<Buffer>}
 */
async function derive(plain, salt, params) {
  DERIVATION_COUNT += 1;
  return /** @type {Buffer} */ (
    await scrypt(plain.normalize("NFKC"), salt, KEY_BYTES, { ...params, maxmem: MAXMEM })
  );
}

/**
 * `scrypt$N=65536,r=8,p=1$<salt b64>$<key b64>`
 *
 * @param {string} plain
 * @returns {Promise<string>}
 */
export async function hashPassword(plain) {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(plain, salt, PARAMS);
  return `scrypt$${formatParams(PARAMS)}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * @param {string} plain
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(plain, stored) {
  // `passwordHash` is a nullable column and a user who only has a passkey has
  // no hash at all, so a null reaching here is ordinary, not exceptional.
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const params = parseParams(parts[1]);
  if (!params) return false;
  // Buffer.from never throws on bad base64 — it drops the invalid characters —
  // so the length checks below are what actually reject a corrupt hash.
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (salt.length === 0 || expected.length !== KEY_BYTES) return false;
  /** @type {Buffer} */
  let actual;
  try {
    actual = await derive(plain, salt, params);
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/**
 * Same derivation, thrown away. Called when the submitted address has no
 * account so that "no such user" costs what "wrong password" costs.
 *
 * @returns {Promise<void>}
 */
export async function burnDummyHash() {
  await derive("dummy", Buffer.alloc(SALT_BYTES, 7), PARAMS);
}
