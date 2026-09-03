import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The proxy drags NextAuth in — and the database with it — only for the session
// guard, which is not exercised here: environment validation happens before
// reaching it. Without this stub the module cannot even be imported in Node.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const ORIGINAL = { ...process.env };

/**
 * What `@/server/setup` answers the proxy's boot announcement, per test.
 *
 * The default says "already claimed", which is the branch that prints nothing
 * and touches no database. Only the last describe in this file is about what an
 * instance prints at boot; every other boot here used to run the real
 * `isClaimed()` against the real database from a promise nothing awaits, and
 * print a real installation token whenever it happened to resolve. Under load
 * those lines arrived inside the one describe that spies on `console.info`:
 * "already claimed, it is not written" failed on a token printed by a boot four
 * describes earlier, and the token-matching test read a line from a copy of the
 * module built with a different AUTH_SECRET, so it compared two tokens that
 * were never meant to match. Neither failure was about the proxy.
 *
 * A mutable holder read through ONE `vi.doMock`, rather than a second
 * `vi.doMock` in the tests that want different answers. Two registrations for
 * the same path is a race: the later one usually wins and about once in twenty
 * runs it did not, which is how "with no owner, the token is written" started
 * failing with the stub that prints nothing. One registration cannot lose.
 */
const bootAnswers = {
  isClaimed: async () => true,
  setupToken: () => "unused-outside-the-boot-announcement-tests",
};

beforeEach(() => {
  bootAnswers.isClaimed = async () => true;
  bootAnswers.setupToken = () => "unused-outside-the-boot-announcement-tests";
  vi.resetModules();
  vi.doMock("@/server/setup", () => ({
    isClaimed: () => bootAnswers.isClaimed(),
    setupToken: () => bootAnswers.setupToken(),
  }));
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("proxy boot", () => {
  it("importing the module without APP_ORIGIN does not throw", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: undefined };
    const imported = await import("./proxy.ts");
    expect(typeof imported.proxy).toBe("function");
  });

  it("the first request without APP_ORIGIN fails naming the variable", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: undefined };
    const { proxy } = await import("./proxy.ts");
    await expect(proxy(new NextRequest("http://localhost:3004/favicon.ico"))).rejects.toThrow(
      /APP_ORIGIN/,
    );
  });

  it("a second request without APP_ORIGIN also fails: the guard is not satisfied yet", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: undefined };
    const { proxy } = await import("./proxy.ts");
    await expect(proxy(new NextRequest("http://localhost:3004/favicon.ico"))).rejects.toThrow(
      /APP_ORIGIN/,
    );
    // If the flag were set before validating, this second request would get past
    // the guard with the configuration still broken: a 500 once, silence after.
    await expect(proxy(new NextRequest("http://localhost:3004/favicon.ico"))).rejects.toThrow(
      /APP_ORIGIN/,
    );
  });

  it("with a valid environment the request carries on", async () => {
    process.env = { ...ORIGINAL, APP_ORIGIN: "http://localhost:3004" };
    const { proxy } = await import("./proxy.ts");
    const response = await proxy(new NextRequest("http://localhost:3004/favicon.ico"));
    expect(response.status).toBe(200);
  });
});

// next.config.ts put HSTS on EVERY response, including the ones the middleware
// cuts short before reaching the end. Now that the header has moved here, that
// coverage has to stay exactly the same or it is a regression.
describe("HSTS on short-circuited responses", () => {
  async function proxyWith(origin: string) {
    process.env = { ...ORIGINAL, APP_ORIGIN: origin };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  it("the redirect to /login carries it: it is the first response a visitor without a session sees", async () => {
    const proxy = await proxyWith("https://shopping.example.com");
    const response = await proxy(new NextRequest("https://shopping.example.com/precios"));
    expect(response.status).toBe(307);
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("the CSRF 403 carries it: an attacker triggers that one effortlessly", async () => {
    const proxy = await proxyWith("https://shopping.example.com");
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/items", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("the API 401 and the public assets carry it too", async () => {
    const proxy = await proxyWith("https://shopping.example.com");
    const unauthorized = await proxy(new NextRequest("https://shopping.example.com/api/items"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("strict-transport-security")).toContain("max-age=");
    const asset = await proxy(new NextRequest("https://shopping.example.com/favicon.ico"));
    expect(asset.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("over http none of them carries it: it would pin the browser to an https that does not exist", async () => {
    const proxy = await proxyWith("http://192.168.1.50:3004");
    const redirect = await proxy(new NextRequest("http://192.168.1.50:3004/precios"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("strict-transport-security")).toBeNull();
    const asset = await proxy(new NextRequest("http://192.168.1.50:3004/favicon.ico"));
    expect(asset.headers.get("strict-transport-security")).toBeNull();
  });
});

// Task 4 left the per-IP bucket at "if there is no address to trust, nothing is
// limited". That took the limiter off EVERY strict route under
// TRUSTED_PROXY=none — the default value — including /api/ingest, whose Bearer
// belongs to no account and is therefore invisible to the per-account brake.
// The per-route ceiling is what keeps an absolute cap there.
describe("per-route ceiling when there is no IP to trust", () => {
  async function proxyWith(env: Record<string, string>) {
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com", ...env };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  function ingest(headers: Record<string, string> = {}) {
    // Strict, public and CSRF-exempt route: the Siri shortcut arrives with no Origin.
    return new NextRequest("https://shopping.example.com/api/ingest/voz", {
      method: "POST",
      headers: headers,
    });
  }

  it("with none the 31st request of the minute is cut off with 429", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 30; i += 1) {
      expect((await proxy(ingest())).status).not.toBe(429);
    }
    const cutOff = await proxy(ingest());
    expect(cutOff.status).toBe(429);
    // The 429 goes out through withHsts like any other response.
    expect(cutOff.headers.get("strict-transport-security")).toContain("max-age=");
  });

  it("with none a forged X-Real-IP header does not open a new bucket", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 30; i += 1) {
      await proxy(ingest({ "x-real-ip": `192.168.0.${i}` }));
    }
    // Thirty made-up addresses and the ceiling still stands: this is what a
    // per-IP bucket cannot do when whoever picks the IP is the attacker.
    expect((await proxy(ingest({ "x-real-ip": "192.168.0.99" }))).status).toBe(429);
  });

  it("the ceiling does not touch non-strict routes", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 40; i += 1) {
      const response = await proxy(
        new NextRequest("https://shopping.example.com/api/items", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        }),
      );
      // Without a session they are 401, never 429: the cap is only for the strict ones.
      expect(response.status).toBe(401);
    }
  });

  it("the ceiling does not touch the reads of a strict route", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 40; i += 1) {
      const response = await proxy(new NextRequest("https://shopping.example.com/login"));
      expect(response.status).not.toBe(429);
    }
  });

  it("each strict route keeps its own count", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 31; i += 1) await proxy(ingest());
    const login = await proxy(
      new NextRequest("https://shopping.example.com/login", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(login.status).not.toBe(429);
  });

  it("a different suffix under the same route does not get a fresh ceiling", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "none" });
    for (let i = 0; i < 30; i += 1) {
      await proxy(
        new NextRequest(`https://shopping.example.com/api/ingest/voz${i}`, { method: "POST" }),
      );
    }
    // The key is the matched prefix, not the pathname: otherwise padding the
    // route would give a new bucket per attempt and the ceiling would be no ceiling.
    expect((await proxy(ingest())).status).toBe(429);
  });
});

describe("with a proxy configured the per-IP bucket rules", () => {
  async function proxyWithTrustedIp() {
    process.env = {
      ...ORIGINAL,
      APP_ORIGIN: "https://shopping.example.com",
      TRUSTED_PROXY: "x-real-ip",
    };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  function ingestFrom(ip: string) {
    return new NextRequest("https://shopping.example.com/api/ingest/voz", {
      method: "POST",
      headers: { "x-real-ip": ip },
    });
  }

  it("the sixth request from the same IP to a strict route is cut off", async () => {
    const proxy = await proxyWithTrustedIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await proxy(ingestFrom("1.2.3.4"))).status).not.toBe(429);
    }
    expect((await proxy(ingestFrom("1.2.3.4"))).status).toBe(429);
  });

  it("the per-route ceiling does not get in the way: 40 different IPs all get through", async () => {
    const proxy = await proxyWithTrustedIp();
    for (let i = 0; i < 40; i += 1) {
      expect((await proxy(ingestFrom(`192.168.0.${i}`))).status).not.toBe(429);
    }
  });
});

// First boot opens two public doors: the setup screen and the route that claims
// the instance. Both accept a secret typed in by a person, so both have to be
// public AND strict: public so they can be reached without an account — there is
// none yet — and strict because they are the only places in this instance where
// guessing is worth the trouble.
describe("first boot in the proxy", () => {
  async function proxyWith(env: Record<string, string> = {}) {
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com", ...env };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  it("/setup is served without a session: there is no account to have one with", async () => {
    const proxy = await proxyWith();
    const response = await proxy(new NextRequest("https://shopping.example.com/setup"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("/api/setup is served without a session", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/setup", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).not.toBe(401);
  });

  it("/api/setup is among the strict routes: the sixth from one IP is cut off", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "x-real-ip" });
    function attempt() {
      return new NextRequest("https://shopping.example.com/api/setup", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "x-real-ip": "1.2.3.4" },
      });
    }
    for (let i = 0; i < 5; i += 1) expect((await proxy(attempt())).status).not.toBe(429);
    expect((await proxy(attempt())).status).toBe(429);
  });

  // The /api/auth prefix is exempt from the CSRF check because NextAuth's own
  // token covers it, and that token does not cover the WebAuthn endpoints this
  // application added under the same prefix. Enrolment is the only irreversible
  // operation in the house: it cannot depend on SameSite alone.
  it("a cross-site POST to passkey enrolment is cut off with 403", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/auth/webauthn/register?step=verify", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("and the one from the instance itself gets through: its calls are same-origin fetches", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/auth/webauthn/register?step=verify", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).not.toBe(403);
  });

  it("NextAuth's own routes keep their exemption", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/auth/callback/credentials", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).not.toBe(403);
  });

  it("the three enrolment steps share a bucket: the cheap one does not buy budget", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "x-real-ip" });
    function stepRequest(step: string) {
      return new NextRequest(`https://shopping.example.com/api/auth/webauthn/register?step=${step}`, {
        method: "POST",
        headers: { "x-real-ip": "1.2.3.4", "sec-fetch-site": "same-origin" },
      });
    }
    // Twelve is the enrolment quota: four complete ceremonies per minute.
    const steps = ["presence", "options", "verify"];
    for (let i = 0; i < 12; i += 1) {
      expect((await proxy(stepRequest(steps[i % 3]))).status).not.toBe(429);
    }
    expect((await proxy(stepRequest("verify"))).status).toBe(429);
  });
});

// Whoever arrives with an invitation has no session — that is the entire point
// of the invitation — so their screen and their redemption route have to be
// public or the proxy sends them to /login and the link is good for nothing.
// Strict for the same reason as /api/setup: they accept a secret that travels
// in the URL.
describe("invitations in the proxy", () => {
  async function proxyWith(env: Record<string, string> = {}) {
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com", ...env };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  const TOKEN = "un-token-de-invitacion-cualquiera";

  it("/invite/<token> is served without a session and without redirecting", async () => {
    const proxy = await proxyWith();
    const response = await proxy(new NextRequest(`https://shopping.example.com/invite/${TOKEN}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  // The exact list is no use for a route that carries a value inside it, and the
  // prefix must not soften the rest: /loginXYZ is not /login.
  it("the public pages prefix does not open /login with a suffix", async () => {
    const proxy = await proxyWith();
    const response = await proxy(new NextRequest("https://shopping.example.com/loginXYZ"));
    expect(response.status).toBe(307);
  });

  it("/api/invitations/redeem is served without a session", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/redeem", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).not.toBe(401);
  });

  // PUBLIC_API_ROUTES matching is by prefix: putting "/api/invitations" instead
  // of the full route would have made CREATION public too, and with it the
  // ability to mint invitations for oneself.
  it("creating invitations still requires a session", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("redemption is among the strict routes: the sixth from one IP is cut off", async () => {
    const proxy = await proxyWith({ TRUSTED_PROXY: "x-real-ip" });
    function attempt() {
      return new NextRequest("https://shopping.example.com/api/invitations/redeem", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "x-real-ip": "1.2.3.4" },
      });
    }
    for (let i = 0; i < 5; i += 1) expect((await proxy(attempt())).status).not.toBe(429);
    expect((await proxy(attempt())).status).toBe(429);
  });

  // PUBLIC_API_ROUTES matching used to be a plain startsWith, so
  // /api/invitations/redeemXYZ counted as public — and Next routes that to
  // /api/invitations/[id], whose DELETE revokes. No real id starts with
  // "redeem", so nothing was actually reachable, but "unreachable by luck" is
  // not the same as closed. It now matches on segment boundaries.
  it("a suffix glued to redeem does not inherit its exemption", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/redeemXYZ", {
        method: "DELETE",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("revoking requires a session", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/lo-que-sea", {
        method: "DELETE",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).toBe(401);
  });

  // The same boundary applies to the other public routes, and there the mistake
  // would have been worse: /api/setupXYZ is not /api/setup.
  it("nor does a suffix glued to /api/setup inherit it", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/setupXYZ", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("and the genuinely public routes still are", async () => {
    const proxy = await proxyWith();
    for (const route of ["/api/health", "/api/setup", "/api/ingest/voz", "/api/auth/session"]) {
      const response = await proxy(new NextRequest(`https://shopping.example.com${route}`));
      expect([route, response.status]).not.toEqual([route, 401]);
    }
  });

  it("a cross-site POST to redeem is cut off with 403", async () => {
    const proxy = await proxyWith();
    const response = await proxy(
      new NextRequest("https://shopping.example.com/api/invitations/redeem", {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
  });
});

// The boot log is the only thing that tells whoever installs this what their
// token is. It goes AFTER `booted = true` on purpose: `booted` means
// "validated", and this opens a database connection, which is not a requirement
// for calling the instance up. That is why it is best effort and a failure here
// cannot turn every request into a 500.
// The strict limiter and the general one shared a counter while being judged
// against different limits — 5 and 100 — so every innocent read spent a quota
// sized for five guessing attempts. Six GETs left the next POST at 429: a
// request rejected for something it did not do, and in the enrolment ceremony
// that falls right on the step after the authenticator prompt.
describe("reads do not spend the writes' quota", () => {
  async function proxyWithTrustedIp() {
    process.env = {
      ...ORIGINAL,
      APP_ORIGIN: "https://shopping.example.com",
      TRUSTED_PROXY: "x-real-ip",
    };
    const { proxy } = await import("./proxy.ts");
    return proxy;
  }

  const IP = "1.2.3.4";
  function get(path: string) {
    return new NextRequest(`https://shopping.example.com${path}`, {
      headers: { "x-real-ip": IP },
    });
  }
  function post(path: string) {
    return new NextRequest(`https://shopping.example.com${path}`, {
      method: "POST",
      headers: { "x-real-ip": IP, "sec-fetch-site": "same-origin" },
    });
  }

  // The quota is held fixed: /api/ingest is still at five, so if read and write
  // shared a counter, six reads would leave the write at 429 without any limit
  // having changed value.
  it("six reads of a strict route capped at five do not cut off the write that follows", async () => {
    const proxy = await proxyWithTrustedIp();
    for (let i = 0; i < 6; i += 1) {
      expect((await proxy(get("/api/ingest/voz"))).status).not.toBe(429);
    }
    expect((await proxy(post("/api/ingest/voz"))).status).not.toBe(429);
  });

  it("thirteen reads of enrolment do not cut off the write that follows either", async () => {
    const proxy = await proxyWithTrustedIp();
    for (let i = 0; i < 13; i += 1) {
      expect((await proxy(get("/api/auth/webauthn/register"))).status).not.toBe(429);
    }
    expect((await proxy(post("/api/auth/webauthn/register?step=options"))).status).not.toBe(429);
  });

  it("the whole ceremony plus a complete retry is not cut off", async () => {
    const proxy = await proxyWithTrustedIp();
    // Sign in with a passkey, then add another one from Settings: login options,
    // the query for how to confirm, and the three enrolment steps.
    const ceremony = [
      post("/api/auth/webauthn/options"),
      get("/api/auth/webauthn/register"),
      post("/api/auth/webauthn/register?step=presence"),
      post("/api/auth/webauthn/register?step=options"),
      post("/api/auth/webauthn/register?step=verify"),
    ];
    for (const request of ceremony) {
      expect((await proxy(request)).status).not.toBe(429);
    }
    // A cancelled Face ID, a mistyped password: the whole thing runs again.
    const retry = [
      post("/api/auth/webauthn/register?step=presence"),
      post("/api/auth/webauthn/register?step=options"),
      post("/api/auth/webauthn/register?step=verify"),
    ];
    for (const request of retry) {
      expect((await proxy(request)).status).not.toBe(429);
    }
  });

  it("enrolment and passkey sign-in no longer share a bucket", async () => {
    const proxy = await proxyWithTrustedIp();
    for (let i = 0; i < 5; i += 1) {
      await proxy(post("/api/auth/webauthn/options"));
    }
    // The login one is at its cap; the enrolment one has spent nothing.
    expect((await proxy(post("/api/auth/webauthn/options"))).status).toBe(429);
    expect((await proxy(post("/api/auth/webauthn/register?step=verify"))).status).not.toBe(429);
  });

  it("the other strict routes keep their five, and a suffix does not get a fresh bucket", async () => {
    const proxy = await proxyWithTrustedIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await proxy(post(`/api/ingest/voz${i}`))).status).not.toBe(429);
    }
    expect((await proxy(post("/api/ingest/voz"))).status).toBe(429);
  });
});

/**
 * The boot announcement is awaited, not waited for.
 *
 * The line comes out of a promise nobody in the request path awaits, and that
 * promise opens a database connection. How long it takes is a property of the
 * machine, not of the code: a cold pool on a loaded runner is not a laptop with
 * a warm one. A fixed 50 ms sleep used to sit here and lost roughly one run in
 * four; polling with a 4 s ceiling replaced it and still lost about one in
 * twelve, because a ceiling is a bet on the same unknown, only a longer one.
 *
 * `proxy.ts` exports the promise itself, so there is nothing left to estimate:
 * awaiting it means the announcement has printed, has decided there was nothing
 * to print, or has failed and said so. Every one of those is a settled answer,
 * and the assertions below can be read as claims about the answer rather than
 * about the clock.
 */

describe("the setup token at boot", () => {
  afterEach(() => {
    vi.doUnmock("@/server/setup");
    vi.resetModules();
  });

  async function boot(claimed: boolean) {
    bootAnswers.isClaimed = async () => claimed;
    bootAnswers.setupToken = () => "token-de-prueba";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env = { ...ORIGINAL, APP_ORIGIN: "https://shopping.example.com" };
    // Both bindings from the same import: `vi.resetModules` in this suite means
    // "a different copy of proxy.ts", and awaiting one copy's announcement
    // while asserting on another's log would prove nothing.
    const proxyModule = await import("./proxy.ts");
    await proxyModule.proxy(new NextRequest("https://shopping.example.com/favicon.ico"));
    await proxyModule.setupAnnouncement();
    return info;
  }

  it("with no owner, the token is written to the log", async () => {
    const info = await boot(false);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("token-de-prueba"));
    info.mockRestore();
  });

  it("already claimed, it is not written: there is nothing left to set up", async () => {
    const info = await boot(true);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  // The two above stub @/server/setup, which is precisely the module whose
  // duplication was the defect: they would have seen nothing. This one uses the
  // real module and checks the only thing that matters — that the printed value
  // is the one another copy of the module accepts.
  it("the printed token is the one a different copy of the module accepts", async () => {
    // The real module, not the file-wide silencer: the duplication this test was
    // written for lives in `@/server/setup`, and a stub of it would have proved
    // nothing.
    vi.doUnmock("@/server/setup");
    vi.resetModules();
    process.env = {
      ...ORIGINAL,
      APP_ORIGIN: "https://shopping.example.com",
      AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
      SETUP_TOKEN: undefined,
    };
    const { prisma } = await import("@/server/db");
    await prisma.webAuthnCredential.deleteMany();
    await prisma.user.deleteMany();
    await prisma.instanceSetup.upsert({
      where: { id: "singleton" },
      update: { claimedAt: null },
      create: { id: "singleton" },
    });

    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const proxyModule = await import("./proxy.ts");
    const beforeBoot = proxyModule.setupAnnouncement();
    await proxyModule.proxy(new NextRequest("https://shopping.example.com/favicon.ico"));
    await proxyModule.setupAnnouncement();

    // The awaited promise has to be the announcement's, not the placeholder the
    // module starts with. Without this, going back to a bare `void isClaimed()`
    // leaves `setupAnnouncement()` returning something already resolved: the
    // await becomes a single microtask, the rest of this test passes on a fast
    // machine, and the race it was written to remove is back with nothing
    // saying so.
    expect(proxyModule.setupAnnouncement()).not.toBe(beforeBoot);

    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("[setup]"));
    // The proxy reports a failed announcement rather than swallowing it, so if
    // the line is missing the warning says why. Reading it into the assertion
    // message turns "expected undefined to be defined" into the actual cause.
    const failure = warn.mock.calls.find((c) => String(c[0]).includes("[setup]"));
    info.mockRestore();
    warn.mockRestore();
    expect(line, failure ? `boot reported: ${failure.map(String).join(" ")}` : undefined).toBeDefined();
    const printed = line!.split(": ")[1];

    // Another instance of the module, like the one Next compiles for the routes.
    vi.resetModules();
    const otherCopy = await import("@/server/setup");
    expect(otherCopy.setupTokenMatches(printed)).toBe(true);
  });
});
