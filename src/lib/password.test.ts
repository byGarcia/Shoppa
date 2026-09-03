import { randomBytes, scryptSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  burnDummyHash,
  DERIVATION_COUNT,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "./password.ts";

describe("hashPassword", () => {
  it("produces the versioned format with algorithm and parameters", async () => {
    const stored = await hashPassword("a long enough password");
    expect(stored.startsWith("scrypt$N=65536,r=8,p=1$")).toBe(true);
    expect(stored.split("$")).toHaveLength(4);
  });

  it("does not reuse the salt, so two hashes of the same thing differ", async () => {
    const a = await hashPassword("a long enough password");
    const b = await hashPassword("a long enough password");
    expect(a).not.toBe(b);
  });

  it("never stores the password in the clear", async () => {
    const stored = await hashPassword("a long enough password");
    expect(stored).not.toContain("a long enough password");
  });

  it("rejects passwords below the minimum length", async () => {
    await expect(hashPassword("short")).rejects.toThrow(new RegExp(String(MIN_PASSWORD_LENGTH)));
  });
});

describe("verifyPassword", () => {
  it("accepts the correct one", async () => {
    const stored = await hashPassword("a long enough password");
    expect(await verifyPassword("a long enough password", stored)).toBe(true);
  });

  it("rejects the wrong one", async () => {
    const stored = await hashPassword("a long enough password");
    expect(await verifyPassword("another long enough password", stored)).toBe(false);
  });

  it("does not accept a hash whose parameter field has been tampered with", async () => {
    // The stored key was derived at N=65536; re-deriving at N=16384 yields a
    // different key, so this must be false. It proves the verifier does not
    // ignore the parameter field — but not, on its own, that it reads it.
    const stored = await hashPassword("a long enough password");
    const weaker = stored.replace("N=65536,r=8,p=1", "N=16384,r=8,p=1");
    expect(await verifyPassword("a long enough password", weaker)).toBe(false);
  });

  it("verifies a hash genuinely derived with weaker parameters", async () => {
    // The forward-compatibility property, and the one that matters: the day the
    // parameters are raised, every existing password must keep working. A
    // verifier "simplified" into comparing the parameter string against today's
    // constants passes the test above and fails this one, after silently
    // locking out every account.
    // scryptSync rather than promisify(scrypt): the promisified overload TypeScript
    // resolves takes no options object, so there is no way to pass N through it.
    const salt = randomBytes(16);
    const key = scryptSync("a long enough password", salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024,
    });
    const legacy = `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${key.toString("base64")}`;
    expect(await verifyPassword("a long enough password", legacy)).toBe(true);
  });

  it("rejects parameters outside the accepted envelope instead of deriving for hours", async () => {
    const stored = await hashPassword("a long enough password");
    const absurd = stored.replace("N=65536,r=8,p=1", "N=32768,r=1,p=1015000");
    const started = Date.now();
    expect(await verifyPassword("a long enough password", absurd)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("returns false for a null hash, which is what a passkey-only user has", async () => {
    expect(await verifyPassword("a long enough password", null as unknown as string)).toBe(false);
  });

  it("returns false for a corrupt hash instead of blowing up", async () => {
    expect(await verifyPassword("a long enough password", "basura")).toBe(false);
    expect(await verifyPassword("a long enough password", "scrypt$N=x$y$z")).toBe(false);
  });
});

describe("burnDummyHash", () => {
  it("really derives, the only thing that matches the cost of a non-existent account", async () => {
    // Asserting that it resolves to undefined is satisfied by an empty function,
    // and an empty function here is exactly the regression that reopens email
    // enumeration in the login. The counter is what makes the test falsifiable;
    // a timing band would be flaky on a loaded machine.
    const before = DERIVATION_COUNT;
    await burnDummyHash();
    expect(DERIVATION_COUNT).toBe(before + 1);
  });
});
