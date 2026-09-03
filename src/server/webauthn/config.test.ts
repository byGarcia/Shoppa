import { afterEach, describe, expect, it } from "vitest";

import { WEBAUTHN_CONFIG } from "./config.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function withEnv(values: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL, ...values };
}

describe("WebAuthn rpID", () => {
  it("the explicit value wins over derivation: the passkey already registered depends on it", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com", WEBAUTHN_RP_ID: "example.com" });
    expect(WEBAUTHN_CONFIG.rpID).toBe("example.com");
  });

  it("with no variable it is derived from the APP_ORIGIN host", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", WEBAUTHN_RP_ID: undefined });
    expect(WEBAUTHN_CONFIG.rpID).toBe("192.168.1.50");
  });

  it("defined but empty throws instead of deriving", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com", WEBAUTHN_RP_ID: "" });
    expect(() => WEBAUTHN_CONFIG.rpID).toThrow(/WEBAUTHN_RP_ID/);
  });
});

describe("WebAuthn origin", () => {
  it("the explicit value wins over derivation", () => {
    withEnv({
      APP_ORIGIN: "https://shopping.example.com",
      WEBAUTHN_ORIGIN: "https://otro.example.com",
    });
    expect(WEBAUTHN_CONFIG.origin).toBe("https://otro.example.com");
  });

  it("with no variable it is APP_ORIGIN itself", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", WEBAUTHN_ORIGIN: undefined });
    expect(WEBAUTHN_CONFIG.origin).toBe("http://192.168.1.50:3004");
  });

  it("defined but empty throws instead of deriving", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com", WEBAUTHN_ORIGIN: "" });
    expect(() => WEBAUTHN_CONFIG.origin).toThrow(/WEBAUTHN_ORIGIN/);
  });
});
