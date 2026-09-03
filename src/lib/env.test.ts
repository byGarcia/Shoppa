import { afterEach, describe, expect, it } from "vitest";

import { appOrigin, assertEnv, authMode, isSecureOrigin, priceFetchMode, trustedProxy } from "./env.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function withEnv(values: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL, ...values };
}

describe("APP_ORIGIN", () => {
  it("accepts an http LAN origin and marks it as not secure", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    expect(appOrigin().host).toBe("192.168.1.50:3004");
    expect(isSecureOrigin()).toBe(false);
  });

  it("accepts https and marks it as secure", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    expect(isSecureOrigin()).toBe(true);
  });

  it("rejects it being missing", () => {
    withEnv({ APP_ORIGIN: undefined });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });

  it("rejects a URL that is not an origin", () => {
    withEnv({ APP_ORIGIN: "no-es-una-url" });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });

  it("rejects an origin with a path, because it gives away a misunderstanding", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com/app" });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });

  it("rejects a scheme that is neither http nor https", () => {
    withEnv({ APP_ORIGIN: "ftp://shopping.example.com" });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });
});

describe("enumerated values", () => {
  it("AUTH_MODE defaults to auto", () => {
    withEnv({ APP_ORIGIN: "https://a.example", AUTH_MODE: undefined });
    expect(authMode()).toBe("auto");
  });

  it("an unknown AUTH_MODE stops the app from starting instead of falling back to the default", () => {
    withEnv({ APP_ORIGIN: "https://a.example", AUTH_MODE: "passkeys" });
    expect(() => assertEnv()).toThrow(/AUTH_MODE/);
  });

  it("TRUSTED_PROXY defaults to none", () => {
    withEnv({ APP_ORIGIN: "https://a.example", TRUSTED_PROXY: undefined });
    expect(trustedProxy()).toBe("none");
  });

  it("an unknown TRUSTED_PROXY stops the app from starting", () => {
    withEnv({ APP_ORIGIN: "https://a.example", TRUSTED_PROXY: "traefik" });
    expect(() => assertEnv()).toThrow(/TRUSTED_PROXY/);
  });

  it("PRICE_FETCH_MODE defaults to local", () => {
    withEnv({ APP_ORIGIN: "https://a.example", PRICE_FETCH_MODE: undefined });
    expect(priceFetchMode()).toBe("local");
  });
});
