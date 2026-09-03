import { afterEach, describe, expect, it } from "vitest";

import { hstsHeader, sessionCookieName } from "./transport.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

// Whole-object replacement rather than assigning process.env.X: Next types
// NODE_ENV as readonly, and one idiom for the whole file beats two.
function withEnv(values: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL, ...values };
}

describe("cookie de sesión", () => {
  it("sobre https lleva el prefijo __Secure-", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    expect(sessionCookieName()).toBe("__Secure-authjs.session-token");
  });

  it("sobre http de LAN no lo lleva, o el navegador la tira", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    expect(sessionCookieName()).toBe("authjs.session-token");
  });

  it("no depende de NODE_ENV", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", NODE_ENV: "production" });
    expect(sessionCookieName()).toBe("authjs.session-token");
  });
});

describe("HSTS", () => {
  it("se envía sobre https", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    expect(hstsHeader()).toContain("max-age=");
  });

  it("no se envía sobre http: fijaría el navegador a un https que no existe", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    expect(hstsHeader()).toBeNull();
  });
});
