import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyRegistrationResponse = vi.fn();
const generateRegistrationOptions = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
  generateRegistrationOptions: (...args: unknown[]) => generateRegistrationOptions(...args),
}));

// readChallengeCookie calls cookies() from next/headers, which throws outside a
// real request. What is tested here is the authority and the transaction, not
// the cookie — which has its own tests in challenge-cookie.test.ts.
const challenge = vi.fn();
const cookiesWritten: Array<{ scope: string; userId?: string; reauthenticated?: boolean }> = [];
const cookiesCleared: number[] = [];
vi.mock("../challenge-cookie", () => ({
  readChallengeCookie: () => challenge(),
  clearChallengeCookieOn: () => {
    cookiesCleared.push(1);
  },
  attachChallengeCookie: async (
    _res: unknown,
    _challenge: string,
    scope: string,
    userId?: string,
    reauthenticated?: boolean,
  ) => {
    cookiesWritten.push({ scope, userId, reauthenticated });
  },
}));

// The presence check uses the assertion verifier from Task 3, which reads a
// real cookie; here all that matters is that reauthenticate demands the right one.
const verifyAssertion = vi.fn();
vi.mock("../credentials-authorize", () => ({
  verifyWebAuthnAssertion: (...args: unknown[]) => verifyAssertion(...args),
}));

const { prisma } = await import("@/server/db");
const { hashPassword } = await import("@/lib/password");
const { makeRegisterOptionsHandler } = await import("./register-options.ts");
const { makeRegisterVerifyHandler } = await import("./register-verify.ts");
const { setupToken } = await import("@/server/setup");
const { createInvitation, hashInvitationToken } = await import("@/server/invitations");
const { resetThrottleForTests, MAX_FAILURES } = await import("@/lib/login-throttle");
const { passkeyAccountStateFor } = await import("./reauthenticate.ts");
const { closedPasskeyCard, passkeyUse } = await import("@/lib/passkey-addition");

const ORIGINAL = { ...process.env };

const ApiResponse = {
  success: <T,>(data: T) => NextResponse.json({ ok: true, data }, { status: 200 }),
  unauthorized: () => NextResponse.json({ error: "No autorizado" }, { status: 401 }),
  badRequest: (message = "Solicitud inválida") => NextResponse.json({ error: message }, { status: 400 }),
};
const handleApiError = (error: unknown) =>
  NextResponse.json({ error: String(error) }, { status: 500 });

function request(body: unknown): NextRequest {
  return new NextRequest("https://shopping.example.com/api/auth/webauthn/register?step=verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function deps(session: { user: { id: string; email: string } } | null) {
  return { ApiResponse, handleApiError, getOptionalAuthSession: async () => session };
}

let userId: string;

beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    APP_ORIGIN: "https://shopping.example.com",
    AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
    AUTH_MODE: "auto",
  };
  vi.clearAllMocks();
  resetThrottleForTests();
  cookiesWritten.length = 0;
  cookiesCleared.length = 0;
  await prisma.securityLog.deleteMany();
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
  await prisma.instanceSetup.upsert({
    where: { id: "singleton" },
    update: { claimedAt: new Date() },
    create: { id: "singleton", claimedAt: new Date() },
  });
  const user = await prisma.user.create({
    data: { email: "ana@example.com", passwordHash: await hashPassword("una contraseña larga") },
    select: { id: true },
  });
  userId = user.id;

  // With the proof of identity already given in the options step: that is what
  // register-verify demands, and it travels inside the signed JWT.
  challenge.mockResolvedValue({
    challenge: "reto",
    scope: "register",
    userId,
    reauthenticated: true,
  });
  verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "credencial-nueva",
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ["internal"],
      },
    },
  });
  generateRegistrationOptions.mockResolvedValue({ challenge: "reto" });
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

const attestation = JSON.stringify({ id: "credencial-nueva" });

describe("passkey registration authorized by the session", () => {
  it("creates the credential and deletes the password in the same transaction", async () => {
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count({ where: { userId } })).toBe(1);
  });

  it("stores the public key as base64url, which is how the verifier reads it", async () => {
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    await handler(request({ attestation }));
    const credential = await prisma.webAuthnCredential.findFirstOrThrow();
    expect(Buffer.from(credential.publicKey, "base64url")).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("with no session, no token and no invitation it registers nothing", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });

  it("a session and a setup token at once is rejected, one is not picked", async () => {
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(request({ attestation, setupToken: setupToken() }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("an invitation that does not exist is rejected, it does not fall into another branch", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(request({ attestation, invitationToken: "lo-que-sea" }));
    expect(res.status).toBe(401);
  });

  it("with AUTH_MODE=password it does not register: it would be a key that does not open and would delete the one that does", async () => {
    process.env.AUTH_MODE = "password";
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(401);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });

  it("a challenge issued for another account cannot be used to hang a credential on it", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "register",
      userId: "otra-cuenta",
      reauthenticated: true,
    });
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("a login challenge is no good for registering", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "login",
      userId,
      reauthenticated: true,
    });
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("if the attestation does not verify, neither the credential nor the password is touched", async () => {
    verifyRegistrationResponse.mockResolvedValue({ verified: false });
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });
});

// A session on its own is not enough for this: registering a passkey deletes the
// password and no screen in this version puts it back, so the only way out is a
// console on the server. A borrowed phone carrying its 30-day JWT cannot be
// enough for that. Deleting a passkey demands the same proof and for the same
// reason; its tests are in delete-credential.test.ts.
describe("proving again who you are before registering", () => {
  const session = () => ({ user: { id: userId, email: "ana@example.com" } });

  it("with no proof at all, the options step issues no challenge", async () => {
    const handler = makeRegisterOptionsHandler(deps(session()));
    const res = await handler(request({}));
    expect(res.status).toBe(400);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
    expect(cookiesWritten).toHaveLength(0);
  });

  it("nor with the wrong password", async () => {
    const handler = makeRegisterOptionsHandler(deps(session()));
    const res = await handler(request({ currentPassword: "no es la suya" }));
    expect(res.status).toBe(400);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("with the right password it issues the challenge marked as confirmed", async () => {
    const handler = makeRegisterOptionsHandler(deps(session()));
    const res = await handler(request({ currentPassword: "una contraseña larga" }));
    expect(res.status).toBe(200);
    expect(cookiesWritten).toEqual([
      { scope: "register", userId, reauthenticated: true },
    ]);
  });

  it("an account with only a passkey confirms with a presence assertion", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-que-ya-tenia",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
    verifyAssertion.mockResolvedValue({ ok: true, user: { id: userId } });

    const handler = makeRegisterOptionsHandler(deps(session()));
    const res = await handler(request({ presenceAssertion: JSON.stringify({ id: "la-que-ya-tenia" }) }));
    expect(res.status).toBe(200);
    // "presence", never "login": a sign-in challenge cannot count as proof for
    // an irreversible change.
    expect(verifyAssertion).toHaveBeenCalledWith(
      "ana@example.com",
      expect.any(String),
      { expectedScope: "presence" },
    );
    expect(cookiesWritten[0].reauthenticated).toBe(true);
  });

  it("an assertion that belongs to another account does not confirm this one", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-que-ya-tenia",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
    verifyAssertion.mockResolvedValue({ ok: true, user: { id: "otra-cuenta" } });

    const handler = makeRegisterOptionsHandler(deps(session()));
    const res = await handler(request({ presenceAssertion: "{}" }));
    expect(res.status).toBe(400);
  });

  // Without this, the confirmation would be a second door to the same password
  // with no brake behind it: the proxy's per-IP bucket — which had to be widened
  // to twelve so that a three-round-trip ceremony can be retried — would be the
  // only cap.
  it("the confirmation password goes through the same brake as sign-in", async () => {
    const handler = makeRegisterOptionsHandler(deps(session()));
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await handler(request({ currentPassword: "no es la suya" }));
    }
    // Throttled: not even the right one issues a challenge while the window lasts.
    const res = await handler(request({ currentPassword: "una contraseña larga" }));
    expect(res.status).toBe(400);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("a failed presence assertion does not throttle the household's sign-in", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-que-ya-tenia",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
    verifyAssertion.mockResolvedValue({ ok: false, user: null, reason: "wa_verify_failed" });
    const handler = makeRegisterOptionsHandler(deps(session()));
    for (let i = 0; i < MAX_FAILURES + 2; i += 1) {
      await handler(request({ presenceAssertion: "{}" }));
    }
    // Counting them would give anyone with a session a way to lock the household
    // out of password sign-in, and an assertion hides no secret to be guessed.
    const { isThrottled } = await import("@/lib/login-throttle");
    expect(isThrottled("ana@example.com")).toBe(false);
  });

  it("a challenge issued without confirmation cannot be spent on the step that writes", async () => {
    challenge.mockResolvedValue({ challenge: "reto", scope: "register", userId });
    const handler = makeRegisterVerifyHandler(deps(session()));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });

  it("the registration is written to security_logs", async () => {
    const handler = makeRegisterVerifyHandler(deps(session()));
    await handler(request({ attestation }));
    const event = await prisma.securityLog.findFirstOrThrow();
    expect(event.eventType).toBe("PASSKEY_REGISTERED");
    expect(event.userId).toBe(userId);
  });

  it("the challenge is burned even when the request fails", async () => {
    challenge.mockResolvedValue({ challenge: "reto", scope: "login", userId });
    const handler = makeRegisterVerifyHandler(deps(session()));
    await handler(request({ attestation }));
    // A challenge that survives its own rejection is one that can be retried.
    expect(cookiesCleared.length).toBeGreaterThan(0);
  });

  it("re-registering the same passkey is a message, not a 500", async () => {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "credencial-nueva",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Ya estaba",
      },
    });
    const handler = makeRegisterVerifyHandler(deps(session()));
    const res = await handler(request({ attestation }));
    expect(res.status).toBe(400);
  });
});

// The Settings card had nobody to ask and said the same thing for every account:
// that the password would stop working. An account migrated from the previous
// application has no password, so it was false from beginning to end. Whether
// there is a password, how many passkeys there are and which ones: that is all
// it needs to tell it right, and it comes out of the same row reauthenticate
// already reads.
describe("what the card can ask about its own account", () => {
  async function addPasskey(
    credentialId: string,
    extra: { deviceName?: string; createdAt?: Date; lastUsedAt?: Date } = {},
  ) {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId,
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: extra.deviceName ?? "Antigua",
        ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
        ...(extra.lastUsedAt ? { lastUsedAt: extra.lastUsedAt } : {}),
      },
    });
  }

  it("an account with a password says it has one and confirms with it", async () => {
    expect(await passkeyAccountStateFor(userId)).toEqual({
      reauth: "password",
      hasPassword: true,
      passkeyCount: 0,
      passkeys: [],
    });
  });

  it("a migrated account — a passkey and no password — says it has none", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await addPasskey("la-que-ya-tenia");
    const state = await passkeyAccountStateFor(userId);
    expect(state.reauth).toBe("presence");
    expect(state.hasPassword).toBe(false);
    expect(state.passkeyCount).toBe(1);
  });

  it("counts the passkeys that already exist, which is what decides whether this one is one more", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await addPasskey("una");
    await addPasskey("otra");
    const state = await passkeyAccountStateFor(userId);
    expect(state.passkeyCount).toBe(2);
    expect(state.hasPassword).toBe(false);
  });

  it("neither password nor passkey: there is nothing to confirm with", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    expect(await passkeyAccountStateFor(userId)).toEqual({
      reauth: null,
      hasPassword: false,
      passkeyCount: 0,
      passkeys: [],
    });
  });

  it("a session for an account that no longer exists gets nothing different", async () => {
    expect(await passkeyAccountStateFor("no-existe")).toEqual({
      reauth: null,
      hasPassword: false,
      passkeyCount: 0,
      passkeys: [],
    });
  });

  // The response goes to the browser as it is (GET on the register route): four
  // fields and no more. Not the hash, not a piece of it, not its length.
  it("carries neither the hash nor any other field of the row", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const state = await passkeyAccountStateFor(userId);
    expect(Object.keys(state).sort()).toEqual([
      "hasPassword",
      "passkeyCount",
      "passkeys",
      "reauth",
    ]);
    const json = JSON.stringify(state);
    expect(json).not.toContain(row.passwordHash);
    // Not even a piece: a prefix of the hash is as publishable as the whole hash.
    expect(json).not.toContain(row.passwordHash!.slice(0, 12));
    expect(json).not.toContain(row.email);
  });

  // The count belongs to the account that is asking and to nobody else.
  it("does not count another account's passkeys", async () => {
    const otherUser = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    await prisma.webAuthnCredential.create({
      data: {
        userId: otherUser.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Suya",
      },
    });
    const state = await passkeyAccountStateFor(userId);
    expect(state.passkeyCount).toBe(0);
    expect(state.passkeys).toEqual([]);
  });
});

/**
 * The list that had never been shown. The household that reported it signs in
 * with its passkey every day and Settings kept inviting it to add the first one:
 * the server knew how many it had and which ones they were, and nobody had asked.
 */
describe("the passkeys it returns so they can be rendered", () => {
  const EARLIER = new Date("2026-06-01T09:00:00.000Z");
  const LATER = new Date("2026-09-02T07:14:00.000Z");

  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
  });

  async function addPasskey(credentialId: string, deviceName: string, dates?: { createdAt: Date; lastUsedAt: Date }) {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId,
        publicKey: "clave-publica-secreta",
        counter: 7n,
        transports: ["internal", "hybrid"],
        deviceName,
        ...(dates ?? {}),
      },
    });
  }

  it("gives the row id, the device name and both dates, in ISO", async () => {
    await addPasskey("la-del-movil", "iPhone", { createdAt: EARLIER, lastUsedAt: LATER });
    const row = await prisma.webAuthnCredential.findFirstOrThrow({ select: { id: true } });
    const [passkey] = (await passkeyAccountStateFor(userId)).passkeys;
    expect(passkey).toEqual({
      id: row.id,
      deviceName: "iPhone",
      createdAt: EARLIER.toISOString(),
      lastUsedAt: LATER.toISOString(),
    });
  });

  it("carries neither the credential id, nor the public key, nor the counter", async () => {
    await addPasskey("la-del-movil", "iPhone");
    const json = JSON.stringify((await passkeyAccountStateFor(userId)).passkeys);
    // The handle that DOES go out is the ROW id, which is what the delete route
    // accepts. The credential one is the authenticator's public identifier and
    // there is no screen that uses it.
    expect(json).not.toContain("la-del-movil");
    expect(json).not.toContain("clave-publica-secreta");
    expect(json).not.toContain("counter");
    expect(json).not.toContain("transports");
  });

  it("returns them from the newest to the oldest", async () => {
    await addPasskey("vieja", "Mac", { createdAt: EARLIER, lastUsedAt: EARLIER });
    await addPasskey("nueva", "iPhone", { createdAt: LATER, lastUsedAt: LATER });
    const state = await passkeyAccountStateFor(userId);
    expect(state.passkeys.map((p) => p.deviceName)).toEqual(["iPhone", "Mac"]);
  });

  it("the count and the list are the same fact: they cannot disagree", async () => {
    await addPasskey("una", "iPhone");
    await addPasskey("otra", "Mac");
    const state = await passkeyAccountStateFor(userId);
    expect(state.passkeyCount).toBe(state.passkeys.length);
  });

  it("one just registered comes out as never used, not as used today", async () => {
    // Both columns default to CURRENT_TIMESTAMP and are filled in the same
    // statement, so equality is what tells "brand new" apart from "used": it is
    // where the card gets "Nunca usada" from.
    await addPasskey("sin-estrenar", "Windows");
    const [passkey] = (await passkeyAccountStateFor(userId)).passkeys;
    expect(passkey.lastUsedAt).toBe(passkey.createdAt);
    expect(passkeyUse(passkey)).toEqual({ key: "neverUsed" });
  });

  it("does not show another account's passkeys", async () => {
    const otherUser = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    await prisma.webAuthnCredential.create({
      data: {
        userId: otherUser.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "El portátil de Luis",
      },
    });
    await addPasskey("la-mia", "iPhone");
    const state = await passkeyAccountStateFor(userId);
    expect(state.passkeys.map((p) => p.deviceName)).toEqual(["iPhone"]);
  });
});

/**
 * And what the card does with that response, in the case that was reported: an
 * account with a passkey must not read anywhere that it has none.
 */
describe("the Settings card of an account that already signs in with a passkey", () => {
  it("neither invites it to add the first one nor says it has none", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-de-cada-mañana",
        publicKey: "clave",
        counter: 3n,
        transports: ["internal"],
        deviceName: "iPhone",
      },
    });

    const state = await passkeyAccountStateFor(userId);
    const closed = closedPasskeyCard({ available: true, account: state });

    expect(closed.subtitle).toEqual({ key: "subtitleCount", count: 1 });
    expect(closed.action).toBe("addAnother");
    expect(closed.passkeys.map((p) => p.deviceName)).toEqual(["iPhone"]);
  });
});

describe("passkey registration on the first start-up", () => {
  beforeEach(async () => {
    await prisma.webAuthnCredential.deleteMany();
    await prisma.user.deleteMany();
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: null } });
    challenge.mockResolvedValue({ challenge: "reto", scope: "register", userId: undefined });
  });

  it("with the right token it creates the account with no password hash", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(request({ attestation, setupToken: setupToken(), email: "Ana@Example.com" }));
    expect(res.status).toBe(200);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.email).toBe("ana@example.com");
    expect(user.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  // The token is checked at both ends: a ceremony is two round trips, and this
  // is the one that writes to the database.
  it("the verify step checks the token again, it does not trust the first one", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(
      request({ attestation, setupToken: "no-es-el-token", email: "ana@example.com" }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it("issuing options with a wrong token does not get past the door either", async () => {
    const handler = makeRegisterOptionsHandler(deps(null));
    const res = await handler(request({ setupToken: "no-es-el-token", email: "ana@example.com" }));
    expect(res.status).toBe(401);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("once the instance is claimed the setup token stops being valid", async () => {
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: new Date() } });
    const handler = makeRegisterOptionsHandler(deps(null));
    const res = await handler(request({ setupToken: setupToken(), email: "ana@example.com" }));
    expect(res.status).toBe(401);
  });

  it("a challenge tied to an account cannot be used to claim the instance", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "register",
      userId: "alguien",
      reauthenticated: true,
    });
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(request({ attestation, setupToken: setupToken(), email: "ana@example.com" }));
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });
});

// The third authority. It is resolved just like the setup token — checked at
// both ends and SPENT only on the one that writes — because an invitation is
// single use: redeeming it on the step that hands out challenges would burn it
// before the account exists, and whoever opened it would be left with the
// authenticator prompt in front of them and nothing behind it.
describe("passkey registration by invitation", () => {
  let token: string;

  beforeEach(async () => {
    token = (await createInvitation(userId)).token;
    challenge.mockResolvedValue({ challenge: "reto", scope: "register", userId: undefined });
  });

  const invitedBody = { attestation, email: "Luis@Example.com" };

  it("with a valid invitation it creates the account with no password hash and marks it used", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(request({ ...invitedBody, invitationToken: token }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "luis@example.com" } });
    expect(user.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(1);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
    });
    expect(invitation.usedAt).not.toBeNull();
  });

  it("the options step issues the challenge and does NOT spend the invitation", async () => {
    const handler = makeRegisterOptionsHandler(deps(null));
    const res = await handler(request({ invitationToken: token, email: "luis@example.com" }));
    expect(res.status).toBe(200);
    expect(cookiesWritten).toEqual([
      // With no account to tie it to and no prior confirmation: the account does
      // not exist yet, so there is nothing to prove again.
      { scope: "register", userId: undefined, reauthenticated: false },
    ]);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
    });
    expect(invitation.usedAt).toBeNull();
  });

  it("an already used invitation does not get past the door in either of the two steps", async () => {
    await makeRegisterVerifyHandler(deps(null))(request({ ...invitedBody, invitationToken: token }));
    const options = await makeRegisterOptionsHandler(deps(null))(
      request({ invitationToken: token, email: "eva@example.com" }),
    );
    expect(options.status).toBe(401);
    const verify = await makeRegisterVerifyHandler(deps(null))(
      request({ attestation, email: "eva@example.com", invitationToken: token }),
    );
    expect(verify.status).toBe(401);
    expect(await prisma.user.findUnique({ where: { email: "eva@example.com" } })).toBeNull();
  });

  it("nor does an expired invitation", async () => {
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await makeRegisterVerifyHandler(deps(null))(
      request({ ...invitedBody, invitationToken: token }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  // The one who decides is redeemInvitation, inside its transaction: the
  // authority resolver said yes and even so nothing is created, because the
  // address already has an account. And the invitation is NOT spent — the whole
  // transaction is rolled back, so whoever holds it can retry with another email.
  it("an already registered email is rejected without spending the invitation", async () => {
    const res = await makeRegisterVerifyHandler(deps(null))(
      request({ attestation, email: "ana@example.com", invitationToken: token }),
    );
    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
    });
    expect(invitation.usedAt).toBeNull();
  });

  it("a session and an invitation at once is rejected, one is not picked", async () => {
    const handler = makeRegisterVerifyHandler(
      deps({ user: { id: userId, email: "ana@example.com" } }),
    );
    const res = await handler(request({ ...invitedBody, invitationToken: token }));
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  it("a challenge tied to an account cannot be used to redeem an invitation", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "register",
      userId: "alguien",
      reauthenticated: true,
    });
    const res = await makeRegisterVerifyHandler(deps(null))(
      request({ ...invitedBody, invitationToken: token }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  it("a passkey already registered here does not count as the email being taken", async () => {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "credencial-nueva",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Ya estaba",
      },
    });
    const res = await makeRegisterVerifyHandler(deps(null))(
      request({ ...invitedBody, invitationToken: token }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("passkey") });
    expect(await prisma.user.count()).toBe(1);
  });

  it("records who came in through that link", async () => {
    await makeRegisterVerifyHandler(deps(null))(request({ ...invitedBody, invitationToken: token }));
    const invitation = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
      include: { redeemedBy: { select: { email: true } } },
    });
    expect(invitation.redeemedBy?.email).toBe("luis@example.com");
  });

  it("registration by invitation is written to security_logs", async () => {
    await makeRegisterVerifyHandler(deps(null))(request({ ...invitedBody, invitationToken: token }));
    const event = await prisma.securityLog.findFirstOrThrow();
    expect(event.eventType).toBe("PASSKEY_REGISTERED");
    expect(event.email).toBe("luis@example.com");
    expect(event.details).toContain("invitation");
  });
});
