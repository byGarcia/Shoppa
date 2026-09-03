import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session. api-utils asks NextAuth's `auth()` for it, and outside a real
// request that does not exist: here it is decided by hand, which is exactly
// what the route has to respect.
let session: { user: { id: string; email: string } } | null = null;
vi.mock("@/lib/auth", () => ({ auth: async () => session }));

// The presence proof uses the assertion verifier, which reads the challenge
// cookie of a real request. All that matters here is that the route DEMANDS a
// proof and that it ties it to this account.
const verifyAssertion = vi.fn();
vi.mock("@/server/webauthn/credentials-authorize", () => ({
  verifyWebAuthnAssertion: (...args: unknown[]) => verifyAssertion(...args),
}));

const { prisma } = await import("@/server/db");
const { hashPassword } = await import("@/lib/password");
const { resetThrottleForTests, MAX_FAILURES } = await import("@/lib/login-throttle");
const { deleteOwnCredential } = await import("./delete-credential.ts");
const { passkeyAccountStateFor } = await import("./reauthenticate.ts");
const { DELETE } = await import("@/app/api/auth/webauthn/credentials/[id]/route.ts");

const ORIGINAL = { ...process.env };
const PASSWORD = "una contraseña larga";

let userId: string;

async function addPasskey(credentialId: string, deviceName = "iPhone"): Promise<string> {
  const row = await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId,
      publicKey: "clave",
      counter: 0n,
      transports: ["internal"],
      deviceName,
    },
    select: { id: true },
  });
  return row.id;
}

function request(body: unknown = {}): NextRequest {
  return new NextRequest("https://shopping.example.com/api/auth/webauthn/credentials/x", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

function deleteKey(id: string, body: unknown = {}) {
  return DELETE(request(body), { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    APP_ORIGIN: "https://shopping.example.com",
    AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
    AUTH_MODE: "auto",
  };
  vi.clearAllMocks();
  resetThrottleForTests();
  await prisma.securityLog.deleteMany();
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
  const user = await prisma.user.create({
    data: { email: "ana@example.com", passwordHash: await hashPassword(PASSWORD) },
    select: { id: true },
  });
  userId = user.id;
  session = { user: { id: userId, email: "ana@example.com" } };
});

afterEach(async () => {
  process.env = { ...ORIGINAL };
  session = null;
  await prisma.securityLog.deleteMany();
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
});

/**
 * Until now a credential could only be added. The passkey of a lost phone kept
 * opening the instance forever and no screen would take it away; the only way
 * was `psql`.
 */
describe("the guard that matters: never leave an account with no way in", () => {
  beforeEach(async () => {
    // An account migrated from the previous application: passkeys and no
    // password. It is the account of everyone who came from before.
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
  });

  it("with a single passkey and no password, the server refuses", async () => {
    const id = await addPasskey("la-unica");
    expect(await deleteOwnCredential(userId, id)).toEqual({
      ok: false,
      reason: "last-credential",
    });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("with two, one can be removed", async () => {
    const first = await addPasskey("una", "iPhone");
    await addPasskey("otra", "Mac");
    expect(await deleteOwnCredential(userId, first)).toEqual({
      ok: true,
      deviceName: "iPhone",
      remaining: 1,
    });
    expect((await passkeyAccountStateFor(userId)).passkeys.map((p) => p.deviceName)).toEqual(["Mac"]);
  });

  it("but the second one no longer can: it has become the only one", async () => {
    const first = await addPasskey("una");
    const second = await addPasskey("otra", "Mac");
    await deleteOwnCredential(userId, first);
    expect(await deleteOwnCredential(userId, second)).toEqual({
      ok: false,
      reason: "last-credential",
    });
  });

  /**
   * The case that decides where the guard lives. Two deletions at once, one for
   * each of the last two credentials: each one reads "there are two", each one
   * deletes its own and the account is left with zero. No attacker needed — two
   * phones, one list on each, one tap on each.
   *
   * What prevents it is `SELECT … FOR UPDATE` on the account row, taken BEFORE
   * counting: the second one is left waiting on the lock and, when it reads,
   * the first has already committed and only one is left.
   */
  it("two deletions at once for the last two: one wins and the account keeps one", async () => {
    const first = await addPasskey("una", "iPhone");
    const second = await addPasskey("otra", "Mac");

    // The other deletion, written by hand so it can be stopped halfway: it
    // takes the account lock, removes ITS credential and sits there without
    // committing. It is what the real function does, with the window held open
    // on purpose.
    const otherDeletion = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT password_hash FROM users WHERE id = ${userId} FOR UPDATE`;
        await tx.webAuthnCredential.deleteMany({ where: { id: first, userId } });
        await new Promise((done) => setTimeout(done, 400));
      },
      { timeout: 15_000 },
    );

    // It comes in with the transaction above half done. Without the lock it
    // reads "there are two" — the other deletion is not committed — and removes
    // its own: zero credentials and nobody can get in. With it, it waits, reads
    // "one is left" and refuses.
    const [, result] = await Promise.all([
      otherDeletion,
      (async () => {
        await new Promise((done) => setTimeout(done, 100));
        return deleteOwnCredential(userId, second);
      })(),
    ]);

    expect(result).toEqual({ ok: false, reason: "last-credential" });
    expect(await prisma.webAuthnCredential.count({ where: { userId } })).toBe(1);
  });

  it("with a password the only passkey can be removed: another door is left", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
    const id = await addPasskey("la-unica");
    expect(await deleteOwnCredential(userId, id)).toMatchObject({ ok: true, remaining: 0 });
  });

  it("except with AUTH_MODE=passkey, where that password opens nothing", async () => {
    // authorizePassword rejects every password in that mode, so a hash left
    // behind by the console rescue is not a way in and cannot authorise
    // removing the last key.
    process.env.AUTH_MODE = "passkey";
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(PASSWORD) },
    });
    const id = await addPasskey("la-unica");
    expect(await deleteOwnCredential(userId, id)).toEqual({
      ok: false,
      reason: "last-credential",
    });
  });
});

describe("whose the named credential is", () => {
  it("another account's is rejected the same as one that does not exist", async () => {
    const otherUser = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    const theirs = await prisma.webAuthnCredential.create({
      data: {
        userId: otherUser.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "El portátil de Luis",
      },
      select: { id: true },
    });

    const notMine = await deleteOwnCredential(userId, theirs.id);
    const madeUp = await deleteOwnCredential(userId, "no-existe-esta-fila");
    // The same response, word for word: the difference between "not yours" and
    // "does not exist" would tell anyone with a session whose a row is.
    expect(notMine).toEqual(madeUp);
    expect(notMine).toEqual({ ok: false, reason: "not-found" });
    expect(await prisma.webAuthnCredential.count({ where: { userId: otherUser.id } })).toBe(1);
  });

  it("a session for an account that no longer exists does not delete anything either", async () => {
    const id = await addPasskey("la-mia");
    expect(await deleteOwnCredential("no-existe", id)).toEqual({ ok: false, reason: "not-found" });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it('a made-up id is not answered with "it is your last one": it does not belong to this account', async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await addPasskey("la-unica");
    // The account IS in the last-key case, and even so the response talks about
    // the id that was named, not about the state of the account.
    expect(await deleteOwnCredential(userId, "no-existe-esta-fila")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

/**
 * Deleting demands the same proof as adding, and for the same reason: a
 * borrowed phone with its 30-day JWT cannot be enough to take away from its
 * owner the key they get in with.
 */
describe("the route: prove again who you are before deleting", () => {
  it("without a session it never gets to look at any row", async () => {
    const id = await addPasskey("la-mia");
    session = null;
    const res = await deleteKey(id, { currentPassword: PASSWORD });
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("with no proof at all, the session alone is not enough", async () => {
    const id = await addPasskey("la-mia");
    const res = await deleteKey(id);
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("nor with the wrong password", async () => {
    const id = await addPasskey("la-mia");
    const res = await deleteKey(id, { currentPassword: "no es la suya" });
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("with the right one, it removes it", async () => {
    const id = await addPasskey("la-mia");
    const res = await deleteKey(id, { currentPassword: PASSWORD });
    expect(res.status).toBe(200);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("the password goes through the same per-account throttle as logging in", async () => {
    const id = await addPasskey("la-mia");
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await deleteKey(id, { currentPassword: "no es la suya" });
    }
    // Throttled: not even the right one deletes anything while the window lasts.
    const res = await deleteKey(id, { currentPassword: PASSWORD });
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("an account with no password confirms with a presence assertion", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    const id = await addPasskey("la-que-se-va");
    await addPasskey("la-que-se-queda", "Mac");
    verifyAssertion.mockResolvedValue({ ok: true, user: { id: userId } });

    const res = await deleteKey(id, { presenceAssertion: JSON.stringify({ id: "la-que-se-queda" }) });
    expect(res.status).toBe(200);
    // "presence", never "login": a login challenge is no good as proof for a
    // change that cannot be undone.
    expect(verifyAssertion).toHaveBeenCalledWith("ana@example.com", expect.any(String), {
      expectedScope: "presence",
    });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("an assertion belonging to another account does not confirm this one", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    const id = await addPasskey("la-que-se-va");
    await addPasskey("otra", "Mac");
    verifyAssertion.mockResolvedValue({ ok: true, user: { id: "otra-cuenta" } });

    const res = await deleteKey(id, { presenceAssertion: "{}" });
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(2);
  });
});

describe("what the route answers", () => {
  it("another account's credential and one that does not exist get the same 404", async () => {
    const otherUser = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    const theirs = await prisma.webAuthnCredential.create({
      data: {
        userId: otherUser.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Suya",
      },
      select: { id: true },
    });

    const notMine = await deleteKey(theirs.id, { currentPassword: PASSWORD });
    const madeUp = await deleteKey("no-existe-esta-fila", { currentPassword: PASSWORD });
    expect(notMine.status).toBe(404);
    expect(madeUp.status).toBe(404);
    expect(await notMine.json()).toEqual(await madeUp.json());
  });

  it("the last key is a 409 with its own code, not a generic error", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    const id = await addPasskey("la-unica");
    verifyAssertion.mockResolvedValue({ ok: true, user: { id: userId } });

    const res = await deleteKey(id, { presenceAssertion: "{}" });
    expect(res.status).toBe(409);
    // The code is what lets the card explain it instead of just showing
    // "could not be deleted".
    expect(await res.json()).toMatchObject({ code: "LAST_CREDENTIAL" });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("the deletion is written to security_logs", async () => {
    const id = await addPasskey("la-mia", "iPhone");
    await deleteKey(id, { currentPassword: PASSWORD });

    const event = await prisma.securityLog.findFirstOrThrow();
    // The enum has had PASSKEY_DELETED from the start and nobody had ever
    // written it: there was no route that deleted.
    expect(event.eventType).toBe("PASSKEY_DELETED");
    expect(event.userId).toBe(userId);
    expect(event.success).toBe(true);
    expect(event.details).toContain("iPhone");
  });

  it("a rejection writes no deletion row", async () => {
    const id = await addPasskey("la-mia");
    await deleteKey(id, { currentPassword: "no es la suya" });
    expect(await prisma.securityLog.count({ where: { eventType: "PASSKEY_DELETED" } })).toBe(0);
  });
});
