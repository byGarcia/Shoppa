import { afterEach, describe, expect, it } from "vitest";

import { WEBAUTHN_CONFIG } from "./config.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function withEnv(values: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL, ...values };
}

describe("rpID de WebAuthn", () => {
  it("el valor explícito gana a la derivación: la passkey ya registrada depende de él", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com", WEBAUTHN_RP_ID: "example.com" });
    expect(WEBAUTHN_CONFIG.rpID).toBe("example.com");
  });

  it("sin variable se deriva del host de APP_ORIGIN", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", WEBAUTHN_RP_ID: undefined });
    expect(WEBAUTHN_CONFIG.rpID).toBe("192.168.1.50");
  });

  it("definida pero vacía lanza en vez de derivar", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com", WEBAUTHN_RP_ID: "" });
    expect(() => WEBAUTHN_CONFIG.rpID).toThrow(/WEBAUTHN_RP_ID/);
  });
});

describe("origin de WebAuthn", () => {
  it("el valor explícito gana a la derivación", () => {
    withEnv({
      APP_ORIGIN: "https://shopping.example.com",
      WEBAUTHN_ORIGIN: "https://otro.example.com",
    });
    expect(WEBAUTHN_CONFIG.origin).toBe("https://otro.example.com");
  });

  it("sin variable es el propio APP_ORIGIN", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004", WEBAUTHN_ORIGIN: undefined });
    expect(WEBAUTHN_CONFIG.origin).toBe("http://192.168.1.50:3004");
  });

  it("definida pero vacía lanza en vez de derivar", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com", WEBAUTHN_ORIGIN: "" });
    expect(() => WEBAUTHN_CONFIG.origin).toThrow(/WEBAUTHN_ORIGIN/);
  });
});
