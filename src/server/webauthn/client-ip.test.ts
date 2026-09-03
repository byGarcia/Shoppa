import { describe, expect, it } from "vitest";

import { clientIPFromHeaders } from "./client-ip.ts";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe("clientIPFromHeaders", () => {
  it("with none it trusts no header", () => {
    const ip = clientIPFromHeaders(
      headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8", "cf-connecting-ip": "9.9.9.9" }),
      { trustedProxy: "none" },
    );
    expect(ip).toBeNull();
  });

  it("with x-real-ip it trusts only that one", () => {
    expect(
      clientIPFromHeaders(headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }), {
        trustedProxy: "x-real-ip",
      }),
    ).toBe("1.2.3.4");
  });

  it("with x-real-ip and that header absent, it does not make one up from x-forwarded-for", () => {
    expect(
      clientIPFromHeaders(headers({ "x-forwarded-for": "5.6.7.8" }), { trustedProxy: "x-real-ip" }),
    ).toBeNull();
  });

  it("with xff it takes the leftmost entry", () => {
    expect(
      clientIPFromHeaders(headers({ "x-forwarded-for": "5.6.7.8, 192.168.0.1" }), { trustedProxy: "xff" }),
    ).toBe("5.6.7.8");
  });

  it("with cloudflare it trusts cf-connecting-ip and not x-real-ip", () => {
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": "9.9.9.9", "x-real-ip": "1.2.3.4" }), {
        trustedProxy: "cloudflare",
      }),
    ).toBe("9.9.9.9");
  });

  // A header holding a single space is truthy. Returned raw it would be a
  // constant key shared by everyone — one bucket for all — and would go into
  // security_logs.ipAddress as "" instead of as null.
  it("a blank header is null, not a shared key", () => {
    expect(clientIPFromHeaders(headers({ "x-real-ip": "   " }), { trustedProxy: "x-real-ip" })).toBeNull();
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": " " }), { trustedProxy: "cloudflare" }),
    ).toBeNull();
    expect(clientIPFromHeaders(headers({ "x-forwarded-for": " , 192.168.0.1" }), { trustedProxy: "xff" })).toBeNull();
  });

  it("an empty header is null", () => {
    expect(clientIPFromHeaders(headers({ "x-real-ip": "" }), { trustedProxy: "x-real-ip" })).toBeNull();
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": "" }), { trustedProxy: "cloudflare" }),
    ).toBeNull();
    expect(clientIPFromHeaders(headers({ "x-forwarded-for": "" }), { trustedProxy: "xff" })).toBeNull();
  });

  it("trims the whitespace around a good value", () => {
    expect(
      clientIPFromHeaders(headers({ "x-real-ip": "  1.2.3.4  " }), { trustedProxy: "x-real-ip" }),
    ).toBe("1.2.3.4");
    expect(
      clientIPFromHeaders(headers({ "cf-connecting-ip": " 9.9.9.9 " }), { trustedProxy: "cloudflare" }),
    ).toBe("9.9.9.9");
  });
});
