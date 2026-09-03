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

describe("session cookie", () => {
  it("over https it carries the __Secure- prefix", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    expect(sessionCookieName()).toBe("__Secure-authjs.session-token");
  });

  it("over http on the LAN it does not, or the browser would drop it", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    expect(sessionCookieName()).toBe("authjs.session-token");
  });

  it("does not depend on NODE_ENV", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", NODE_ENV: "production" });
    expect(sessionCookieName()).toBe("authjs.session-token");
  });
});

describe("HSTS", () => {
  it("is sent over https", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    expect(hstsHeader()).toContain("max-age=");
  });

  it("is not sent over http: it would pin the browser to an https that does not exist", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    expect(hstsHeader()).toBeNull();
  });
});
