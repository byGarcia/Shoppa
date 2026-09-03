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
  it("acepta la contraseña correcta", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    const result = await authorizePassword("ana@example.com", "una contraseña larga");
    expect(result.ok).toBe(true);
  });

  it("rechaza la equivocada", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    expect((await authorizePassword("ana@example.com", "otra cosa distinta")).ok).toBe(false);
  });

  it("con AUTH_MODE=passkey no atiende contraseñas en absoluto", async () => {
    process.env.AUTH_MODE = "passkey";
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    const result = await authorizePassword("ana@example.com", "una contraseña larga");
    expect(result.ok).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("un usuario con passkey y sin hash no entra con contraseña", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0, passwordHash: null,
    });
    expect((await authorizePassword("ana@example.com", "lo que sea largo")).ok).toBe(false);
  });

  it("hace el mismo trabajo criptográfico cuando el correo no existe", async () => {
    // Sin medir tiempos: un reloj en una máquina cargada no prueba nada. El
    // contador de derivaciones es lo que hace falsable que burnDummyHash no
    // sea una función vacía.
    findUnique.mockResolvedValue(null);
    const before = DERIVATION_COUNT;
    await authorizePassword("nadie@example.com", "lo que sea largo");
    expect(DERIVATION_COUNT).toBe(before + 1);
  });

  it("frena tras cinco fallos seguidos de la misma cuenta", async () => {
    findUnique.mockResolvedValue({
      id: "u1", email: "ana@example.com", name: null, tokenVersion: 0,
      passwordHash: await hashPassword("una contraseña larga"),
    });
    for (let i = 0; i < 5; i += 1) await authorizePassword("ana@example.com", "mal mal mal mal");
    const result = await authorizePassword("ana@example.com", "una contraseña larga");
    expect(result.ok).toBe(false);
  });

  it("el camino frenado también paga la derivación", async () => {
    // isThrottled corta antes de verifyPassword: sin quemar un hash, la
    // respuesta frenada vuelve en microsegundos y delata qué cuentas están
    // bajo ataque, y por tanto cuáles existen.
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await authorizePassword("ana@example.com", "mal mal mal mal");
    const before = DERIVATION_COUNT;
    const result = await authorizePassword("ana@example.com", "mal mal mal mal");
    expect(result).toEqual({ ok: false, reason: "throttled" });
    expect(DERIVATION_COUNT).toBe(before + 1);
  });

  it("cuenta los fallos aunque la cuenta no exista", async () => {
    // Contar sólo las cuentas reales convertiría el freno en un oráculo de
    // enumeración más limpio que el que cierra burnDummyHash.
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await authorizePassword("nadie@example.com", "lo que sea largo");
    const result = await authorizePassword("nadie@example.com", "lo que sea largo");
    expect(result).toEqual({ ok: false, reason: "throttled" });
  });

  it("normaliza la cuenta frenada igual que el módulo del freno", async () => {
    findUnique.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await authorizePassword("ana@example.com", "lo que sea largo");
    const result = await authorizePassword("  Ana@Example.com  ", "lo que sea largo");
    expect(result).toEqual({ ok: false, reason: "throttled" });
  });
});
