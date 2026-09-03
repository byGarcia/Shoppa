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

async function writtenCookie() {
  const res = NextResponse.next();
  await attachChallengeCookie(res, "reto", "login", "usuario-1");
  const [cookie] = res.cookies.getAll();
  return cookie;
}

describe("WebAuthn challenge cookie", () => {
  it("over https it carries the __Secure- prefix and secure", async () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    const cookie = await writtenCookie();
    expect(cookie.name).toBe("__Secure-home.wa-challenge");
    expect(cookie.secure).toBe(true);
  });

  it("over http on the LAN it carries neither prefix nor secure, or the browser drops it", async () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    const cookie = await writtenCookie();
    expect(cookie.name).toBe("home.wa-challenge");
    expect(cookie.secure).toBe(false);
  });

  it("does not depend on NODE_ENV: that is what broke login on the LAN", async () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", NODE_ENV: "production" });
    const cookie = await writtenCookie();
    expect(cookie.name).toBe("home.wa-challenge");
    expect(cookie.secure).toBe(false);
  });

  it("clearing it uses the same name it was written with", async () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    const written = await writtenCookie();
    const res = NextResponse.next();
    clearChallengeCookieOn(res);
    const [cleared] = res.cookies.getAll();
    expect(cleared.name).toBe(written.name);
    expect(cleared.secure).toBe(false);
    expect(cleared.maxAge).toBe(0);
  });
});
