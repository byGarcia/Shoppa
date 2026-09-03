import { beforeEach, describe, expect, it, vi } from "vitest";

import { DERIVATION_COUNT, hashPassword } from "./password.ts";

const findUnique = vi.fn();
vi.mock("@/server/db", () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

const { authorizePassword } = await import("./auth-password.ts");
const { resetThrottleForTests } = await import("./login-throttle.ts");

beforeEach(() => {
  findUnique.mockReset();
  resetThrottleForTests();
  process.env.APP_ORIGIN = "https://a.example";
  process.env.AUTH_MODE = "auto";
});

describe("authorizePassword", () => {
  it("accepts the correct password", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    const result = await authorizePassword("ana@example.com", "una contraseña larga");
    expect(result.ok).toBe(true);
  });

  it("rejects the wrong one", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    expect((await authorizePassword("ana@example.com", "otra cosa distinta")).ok).toBe(false);
  });

  it("with AUTH_MODE=passkey it does not serve passwords at all", async () => {
    process.env.AUTH_MODE = "passkey";
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    const result = await authorizePassword("ana@example.com", "una contraseña larga");
    expect(result.ok).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("a user with a passkey and no hash cannot get in with a password", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0, passwordHash: null,
    });
    expect((await authorizePassword("ana@example.com", "lo que sea largo")).ok).toBe(false);
  });

  it("does the same cryptographic work when the email does not exist", async () => {
    // No timing measurements: a clock on a loaded machine proves nothing. The
    // derivation counter is what makes it falsifiable that burnDummyHash is
    // not an empty function.
    findUnique.mockResolvedValue(null);
    const before = DERIVATION_COUNT;
    await authorizePassword("nadie@example.com", "lo que sea largo");
    expect(DERIVATION_COUNT).toBe(before + 1);
  });

  it("throttles after five consecutive failures from the same account", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    for (let i = 0; i < 5; i += 1) await authorizePassword("ana@example.com", "mal mal mal mal");
    const result = await authorizePassword("ana@example.com", "una contraseña larga");
    expect(result.ok).toBe(false);
  });

  it("the throttled path pays for the derivation too", async () => {
    // isThrottled cuts in before verifyPassword: without burning a hash, the
    // throttled response comes back in microseconds and gives away which
    // accounts are under attack, and therefore which ones exist.
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await authorizePassword("ana@example.com", "mal mal mal mal");
    const before = DERIVATION_COUNT;
    const result = await authorizePassword("ana@example.com", "mal mal mal mal");
    expect(result).toEqual({ ok: false, reason: "throttled" });
    expect(DERIVATION_COUNT).toBe(before + 1);
  });

  it("counts failures even when the account does not exist", async () => {
    // Counting only the real accounts would turn the throttle into a cleaner
    // enumeration oracle than the one burnDummyHash closes.
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await authorizePassword("nadie@example.com", "lo que sea largo");
    const result = await authorizePassword("nadie@example.com", "lo que sea largo");
    expect(result).toEqual({ ok: false, reason: "throttled" });
  });

  it("normalizes the throttled account the same way the throttle module does", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await authorizePassword("ana@example.com", "lo que sea largo");
    const result = await authorizePassword("  Ana@Example.com  ", "lo que sea largo");
    expect(result).toEqual({ ok: false, reason: "throttled" });
  });
});
