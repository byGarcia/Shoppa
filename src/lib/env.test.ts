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
  it("acepta un origen http de LAN y lo marca como no seguro", () => {
    withEnv({ APP_ORIGIN: "http://192.168.1.50:3004" });
    expect(appOrigin().host).toBe("192.168.1.50:3004");
    expect(isSecureOrigin()).toBe(false);
  });

  it("acepta https y lo marca como seguro", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com" });
    expect(isSecureOrigin()).toBe(true);
  });

  it("rechaza que falte", () => {
    withEnv({ APP_ORIGIN: undefined });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });

  it("rechaza una URL que no es un origen", () => {
    withEnv({ APP_ORIGIN: "no-es-una-url" });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });

  it("rechaza un origen con ruta, porque delata una confusión", () => {
    withEnv({ APP_ORIGIN: "https://shopping.example.com/app" });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });

  it("rechaza un esquema que no es http ni https", () => {
    withEnv({ APP_ORIGIN: "ftp://shopping.example.com" });
    expect(() => assertEnv()).toThrow(/APP_ORIGIN/);
  });
});

describe("valores enumerados", () => {
  it("AUTH_MODE es auto por defecto", () => {
    withEnv({ APP_ORIGIN: "https://a.example", AUTH_MODE: undefined });
    expect(authMode()).toBe("auto");
  });

  it("un AUTH_MODE desconocido impide arrancar en vez de caer al defecto", () => {
    withEnv({ APP_ORIGIN: "https://a.example", AUTH_MODE: "passkeys" });
    expect(() => assertEnv()).toThrow(/AUTH_MODE/);
  });

  it("TRUSTED_PROXY es none por defecto", () => {
    withEnv({ APP_ORIGIN: "https://a.example", TRUSTED_PROXY: undefined });
    expect(trustedProxy()).toBe("none");
  });

  it("un TRUSTED_PROXY desconocido impide arrancar", () => {
    withEnv({ APP_ORIGIN: "https://a.example", TRUSTED_PROXY: "traefik" });
    expect(() => assertEnv()).toThrow(/TRUSTED_PROXY/);
  });

  it("PRICE_FETCH_MODE es local por defecto", () => {
    withEnv({ APP_ORIGIN: "https://a.example", PRICE_FETCH_MODE: undefined });
    expect(priceFetchMode()).toBe("local");
  });
});
