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
  it("produce el formato versionado con algoritmo y parámetros", async () => {
    const stored = await hashPassword("una contraseña larga");
    expect(stored.startsWith("scrypt$N=65536,r=8,p=1$")).toBe(true);
    expect(stored.split("$")).toHaveLength(4);
  });

  it("no repite la sal, así que dos hashes de lo mismo difieren", async () => {
    const a = await hashPassword("una contraseña larga");
    const b = await hashPassword("una contraseña larga");
    expect(a).not.toBe(b);
  });

  it("nunca guarda la contraseña en claro", async () => {
    const stored = await hashPassword("una contraseña larga");
    expect(stored).not.toContain("una contraseña larga");
  });

  it("rechaza contraseñas por debajo del mínimo", async () => {
    await expect(hashPassword("corta")).rejects.toThrow(new RegExp(String(MIN_PASSWORD_LENGTH)));
  });
});

describe("verifyPassword", () => {
  it("acepta la correcta", async () => {
    const stored = await hashPassword("una contraseña larga");
    expect(await verifyPassword("una contraseña larga", stored)).toBe(true);
  });

  it("rechaza la equivocada", async () => {
    const stored = await hashPassword("una contraseña larga");
    expect(await verifyPassword("otra contraseña larga", stored)).toBe(false);
  });

  it("no acepta un hash cuyo campo de parámetros ha sido manipulado", async () => {
    // The stored key was derived at N=65536; re-deriving at N=16384 yields a
    // different key, so this must be false. It proves the verifier does not
    // ignore the parameter field — but not, on its own, that it reads it.
    const stored = await hashPassword("una contraseña larga");
    const weaker = stored.replace("N=65536,r=8,p=1", "N=16384,r=8,p=1");
    expect(await verifyPassword("una contraseña larga", weaker)).toBe(false);
  });

  it("verifica un hash derivado de verdad con parámetros más flojos", async () => {
    // The forward-compatibility property, and the one that matters: the day the
    // parameters are raised, every existing password must keep working. A
    // verifier "simplified" into comparing the parameter string against today's
    // constants passes the test above and fails this one, after silently
    // locking out every account.
    // scryptSync rather than promisify(scrypt): the promisified overload TypeScript
    // resolves takes no options object, so there is no way to pass N through it.
    const salt = randomBytes(16);
    const key = scryptSync("una contraseña larga", salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024,
    });
    const legacy = `scrypt$N=16384,r=8,p=1$${salt.toString("base64")}$${key.toString("base64")}`;
    expect(await verifyPassword("una contraseña larga", legacy)).toBe(true);
  });

  it("rechaza parámetros fuera del sobre admitido en vez de derivar durante horas", async () => {
    const stored = await hashPassword("una contraseña larga");
    const absurd = stored.replace("N=65536,r=8,p=1", "N=32768,r=1,p=1015000");
    const started = Date.now();
    expect(await verifyPassword("una contraseña larga", absurd)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("devuelve false ante un hash nulo, que es lo que tiene un usuario con sólo passkey", async () => {
    expect(await verifyPassword("una contraseña larga", null as unknown as string)).toBe(false);
  });

  it("devuelve false ante un hash corrupto en vez de reventar", async () => {
    expect(await verifyPassword("una contraseña larga", "basura")).toBe(false);
    expect(await verifyPassword("una contraseña larga", "scrypt$N=x$y$z")).toBe(false);
  });
});

describe("burnDummyHash", () => {
  it("deriva de verdad, que es lo único que iguala el coste de una cuenta inexistente", async () => {
    // Asserting that it resolves to undefined is satisfied by an empty function,
    // and an empty function here is exactly the regression that reopens email
    // enumeration in the login. The counter is what makes the test falsifiable;
    // a timing band would be flaky on a loaded machine.
    const before = DERIVATION_COUNT;
    await burnDummyHash();
    expect(DERIVATION_COUNT).toBe(before + 1);
  });
});
