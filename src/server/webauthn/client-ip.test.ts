import { describe, expect, it } from "vitest";

import { clientIPFromHeaders } from "./client-ip.ts";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("clientIPFromHeaders", () => {
  it("con none no se cree ninguna cabecera", () => {
    const ip = clientIPFromHeaders(
      headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8", "cf-connecting-ip": "9.9.9.9" }),
      { trustedProxy: "none" },
    );
    expect(ip).toBeNull();
  });

  it("con x-real-ip se cree sólo esa", () => {
    expect(
      clientIPFromHeaders(headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }), {
        trustedProxy: "x-real-ip",
      }),
    ).toBe("1.2.3.4");
  });

  it("con x-real-ip y sin esa cabecera, no inventa desde x-forwarded-for", () => {
    expect(
      clientIPFromHeaders(headers({ "x-forwarded-for": "5.6.7.8" }), { trustedProxy: "x-real-ip" }),
    ).toBeNull();
  });

  it("con xff toma la entrada de la izquierda", () => {
    expect(
      clientIPFromHeaders(headers({ "x-forwarded-for": "5.6.7.8, 192.168.0.1" }), { trustedProxy: "xff" }),
    ).toBe("5.6.7.8");
  });

  it("con cloudflare se cree cf-connecting-ip y no x-real-ip", () => {
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": "9.9.9.9", "x-real-ip": "1.2.3.4" }), {
        trustedProxy: "cloudflare",
      }),
    ).toBe("9.9.9.9");
  });

  // Una cabecera de un espacio es «truthy». Devuelta en crudo sería una clave
  // constante compartida por todo el mundo —un solo cubo para todos— y entraría
  // como "" en security_logs.ipAddress en vez de como null.
  it("una cabecera en blanco es nula, no una clave compartida", () => {
    expect(clientIPFromHeaders(headers({ "x-real-ip": "   " }), { trustedProxy: "x-real-ip" })).toBeNull();
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": " " }), { trustedProxy: "cloudflare" }),
    ).toBeNull();
    expect(clientIPFromHeaders(headers({ "x-forwarded-for": " , 192.168.0.1" }), { trustedProxy: "xff" })).toBeNull();
  });

  it("una cabecera vacía es nula", () => {
    expect(clientIPFromHeaders(headers({ "x-real-ip": "" }), { trustedProxy: "x-real-ip" })).toBeNull();
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": "" }), { trustedProxy: "cloudflare" }),
    ).toBeNull();
    expect(clientIPFromHeaders(headers({ "x-forwarded-for": "" }), { trustedProxy: "xff" })).toBeNull();
  });

  it("recorta los espacios alrededor del valor bueno", () => {
    expect(
      clientIPFromHeaders(headers({ "x-real-ip": "  1.2.3.4  " }), { trustedProxy: "x-real-ip" }),
    ).toBe("1.2.3.4");
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": " 9.9.9.9 " }), { trustedProxy: "cloudflare" }),
    ).toBe("9.9.9.9");
  });
});
