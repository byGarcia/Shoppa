import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { attachChallengeCookie, clearChallengeCookieOn } from "./challenge-cookie.ts";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, AUTH_SECRET: "secreto-de-prueba-suficientemente-largo" };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function withEnv(values: Record<string, string | undefined>): void {
  process.env = { ...process.env, ...values };
}

async function cookieEscrita() {
  const res = NextResponse.next();
  await attachChallengeCookie(res, "reto", "login", "usuario-1");
  const [cookie] = res.cookies.getAll();
  return cookie;
}

describe("cookie de reto WebAuthn", () => {
  it("sobre https lleva el prefijo __Secure- y secure", async () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    const cookie = await cookieEscrita();
    expect(cookie.name).toBe("__Secure-home.wa-challenge");
    expect(cookie.secure).toBe(true);
  });

  it("sobre http de LAN no lleva prefijo ni secure, o el navegador la tira", async () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    const cookie = await cookieEscrita();
    expect(cookie.name).toBe("home.wa-challenge");
    expect(cookie.secure).toBe(false);
  });

  it("no depende de NODE_ENV: es lo que rompía el login de la LAN", async () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", NODE_ENV: "production" });
    const cookie = await cookieEscrita();
    expect(cookie.name).toBe("home.wa-challenge");
    expect(cookie.secure).toBe(false);
  });

  it("al limpiarla usa el mismo nombre que al escribirla", async () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    const escrita = await cookieEscrita();
    const res = NextResponse.next();
    clearChallengeCookieOn(res);
    const [borrada] = res.cookies.getAll();
    expect(borrada.name).toBe(escrita.name);
    expect(borrada.secure).toBe(false);
    expect(borrada.maxAge).toBe(0);
  });
});
