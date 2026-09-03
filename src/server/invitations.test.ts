import { beforeEach, describe, expect, it, vi } from "vitest";

// Counts the derivations without replacing them: the rest of the file needs
// scrypt to still be the real scrypt.
const derivations = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/password", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/password")>();
  return {
    ...real,
    hashPassword: async (plain: string) => {
      derivations.n += 1;
      return real.hashPassword(plain);
    },
  };
});

import { prisma } from "./db.ts";
import {
  createInvitation,
  hashInvitationToken,
  inspectInvitation,
  listInvitations,
  redeemInvitation,
  revokeInvitation,
} from "./invitations.ts";

let inviterId: string;

beforeEach(async () => {
  await prisma.webAuthnCredential.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.user.deleteMany();
  inviterId = (await prisma.user.create({ data: { email: "ana@example.com" } })).id;
  derivations.n = 0;
});

/** The users there are besides the inviter. */
async function newUsers(): Promise<number> {
  return (await prisma.user.count()) - 1;
}

describe("invitations", () => {
  it("stores the hash and not the token", async () => {
    const { token } = await createInvitation(inviterId);
    const stored = await prisma.invitation.findFirst();
    expect(stored?.tokenHash).not.toBe(token);
    // And the hash is the one looked up when redeeming: storing "something
    // different" is not storing the hash. Without this, a digest of anything
    // else would pass just the same.
    expect(stored?.tokenHash).toBe(hashInvitationToken(token));
  });

  it("is redeemed once and only once", async () => {
    const { token } = await createInvitation(inviterId);
    const first = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(first.ok).toBe(true);
    const second = await redeemInvitation({
      token,
      email: "otro@example.com",
      password: "otra contraseña larga",
    });
    expect(second).toEqual({ ok: false, reason: "used" });
    expect(await newUsers()).toBe(1);
  });

  it("an expired one is no good", async () => {
    const { token } = await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(
      await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  // Expiry travels INSIDE the conditional UPDATE, so an expired invitation
  // matches no row and is not marked used. If it were checked before and marked
  // after, "expired" would clobber "used" and the reason shown to whoever opens
  // the link would depend on the order in which the two were looked at.
  it("an expired one is not spent: it stays unused", async () => {
    const { token } = await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" });
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
  });

  it("a made-up token creates no user", async () => {
    const before = await prisma.user.count();
    const result = await redeemInvitation({
      token: "inventado",
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(result).toEqual({ ok: false, reason: "unknown" });
    expect(await prisma.user.count()).toBe(before);
  });

  // The clock is sampled on BOTH sides of the call, not just before. With a
  // single sample taken beforehand, the time the insert takes adds onto the
  // deadline and the comparison against "exactly 72" came out as
  // 72.00000027777777: red in the whole suite and green on its own. It has
  // interrupted two tasks that had nothing to do with invitations.
  //
  // Bracketing it between the two samples does not loosen what it checks, it
  // tightens it: the deadline is issued at some instant between `before` and
  // `after`, so measured from the later one it cannot exceed 72 h and
  // measured from the earlier one it cannot fall short. The two bounds together
  // pin the constant down — with 71 h the bottom one fails and with 73 h the
  // top one — and neither depends on how long it took. The 72 is written out by
  // hand here: comparing against INVITATION_TTL_MS would be asking the constant
  // about itself.
  it("expires at 72 hours", async () => {
    const HOUR = 3_600_000;
    const before = Date.now();
    const { expiresAt } = await createInvitation(inviterId);
    const after = Date.now();
    expect(expiresAt.getTime() - after).toBeLessThanOrEqual(72 * HOUR);
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(72 * HOUR);
  });

  it("stores the email lowercased and without whitespace", async () => {
    const { token } = await createInvitation(inviterId);
    const result = await redeemInvitation({
      token,
      email: "  Luis@Example.COM  ",
      password: "una contraseña larga",
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findFirst({ where: { email: "luis@example.com" } });
    expect(user).not.toBeNull();
  });

  it("with neither password nor credential it creates nothing and leaves the invitation unused", async () => {
    const { token } = await createInvitation(inviterId);
    expect(await redeemInvitation({ token, email: "luis@example.com" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await newUsers()).toBe(0);
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
  });

  // The unique index on lower(email) fires INSIDE the transaction, so it takes
  // the UPDATE down with it: the invitation is not spent on an account that
  // never came to exist, and whoever holds it can retry with the address they
  // wanted.
  it("an already registered email does not spend the invitation", async () => {
    const { token } = await createInvitation(inviterId);
    const clash = await redeemInvitation({
      token,
      email: "ANA@example.com",
      password: "una contraseña larga",
    });
    expect(clash).toEqual({ ok: false, reason: "email-taken" });
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();

    const good = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(good.ok).toBe(true);
  });

  it("an invitation redeemed with a credential stores no password hash", async () => {
    const { token } = await createInvitation(inviterId);
    const result = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
      credential: {
        credentialId: "credencial-de-invitado",
        publicKey: "clave-publica",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Dispositivo de prueba",
      },
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findUnique({
      where: { email: "luis@example.com" },
      select: { passwordHash: true },
    });
    expect(user?.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  // The invitation belongs to the instance, not to whoever sent it: if the link
  // broke when the inviter is deleted, the explanation would have to be
  // somewhere. It is in the schema — ON DELETE CASCADE — and it says the
  // opposite: it goes away.
  it("if the inviter is deleted, their invitation disappears", async () => {
    const { token } = await createInvitation(inviterId);
    await prisma.user.delete({ where: { id: inviterId } });
    expect(await prisma.invitation.count()).toBe(0);
    expect(
      await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      }),
    ).toEqual({ ok: false, reason: "unknown" });
  });

  it("looking at an invitation does not spend it", async () => {
    const { token } = await createInvitation(inviterId);
    expect(await inspectInvitation(token)).toEqual({ ok: true });
    expect(await inspectInvitation(token)).toEqual({ ok: true });
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
    expect(
      (await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      })).ok,
    ).toBe(true);
    expect(await inspectInvitation(token)).toEqual({ ok: false, reason: "used" });
    expect(await inspectInvitation("inventado")).toEqual({ ok: false, reason: "unknown" });
  });

  it("of two simultaneous redemptions only one goes through", async () => {
    const { token } = await createInvitation(inviterId);
    const [a, b] = await Promise.all([
      redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" }),
      redeemInvitation({ token, email: "eva@example.com", password: "otra contraseña larga" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await newUsers()).toBe(1);
  });

  // The Promise.all above does NOT discriminate: the task 9 review showed that
  // a "read and then write" passes it just the same, because the two
  // transactions have to genuinely overlap and the window is a couple of
  // milliseconds — with the preceding scrypt piling jitter on top. This one
  // forces the overlap: it keeps the row locked in an uncommitted transaction
  // while the real redemption arrives. The redemption's UPDATE ends up waiting
  // on the lock and, once it is released, matches zero rows. A "read and
  // decide" would have read used_at NULL from the pre-commit snapshot and
  // created the account anyway.
  it("a redemption arriving with the row locked by another transaction does not go through", async () => {
    const { token } = await createInvitation(inviterId);
    const tokenHash = hashInvitationToken(token);

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
      entered();
      await held;
    });

    await hasEntered;
    const late = redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    // Plenty of time for the late one's UPDATE to reach the lock.
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;

    expect(await late).toEqual({ ok: false, reason: "used" });
    expect(await newUsers()).toBe(0);
  });
});

// Redemption is public (/api/invitations/redeem asks for no session: whoever
// arrives invited has none), so what it costs to serve is chosen by a stranger.
// scrypt with N=65536 is ~64 MiB and ~100 ms per call, and libuv's threadpool
// has four slots: deriving before looking at the token is handing anyone the
// memory of a machine that may well be a Raspberry Pi. claimInstance already
// does it in this order — check the token, derive afterwards — and here it was
// missing.
describe("what a made-up token costs", () => {
  it("a token that does not exist derives no key", async () => {
    const result = await redeemInvitation({
      token: "inventado",
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(result).toEqual({ ok: false, reason: "unknown" });
    expect(derivations.n).toBe(0);
  });

  it("an expired one and a used one do not either", async () => {
    const expired = await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await redeemInvitation({
      token: expired.token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });

    const used = await createInvitation(inviterId);
    await redeemInvitation({
      token: used.token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    const derivationsSoFar = derivations.n;
    await redeemInvitation({
      token: used.token,
      email: "eva@example.com",
      password: "otra contraseña larga",
    });
    expect(derivations.n).toBe(derivationsSoFar);
  });

  it("a good invitation does derive: the preceding read replaces nothing", async () => {
    const { token } = await createInvitation(inviterId);
    await redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" });
    expect(derivations.n).toBe(1);
  });

  // The preceding read is only cost: what decides is still the conditional
  // UPDATE. If moving the check earlier had moved the decision, this test — the
  // lock one, the only one that discriminates — would have gone red.
  it("and it still decides nothing: with the row locked the redemption does not go through", async () => {
    const { token } = await createInvitation(inviterId);
    const tokenHash = hashInvitationToken(token);

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
      entered();
      await held;
    });

    await hasEntered;
    // The preceding read sees the invitation still unused — the transaction
    // holding the lock has not committed — so the redemption sails past and
    // reaches the UPDATE.
    const late = redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;

    expect(await late).toEqual({ ok: false, reason: "used" });
    expect(await newUsers()).toBe(0);
  });
});

// Both writes in the transaction have a unique index behind them. Counting any
// P2002 as "that email is already taken" would tell whoever arrives invited
// something false about somebody else's account.
describe("which unique index the rejection comes from", () => {
  it("an already registered passkey is not counted as a taken email", async () => {
    await prisma.webAuthnCredential.create({
      data: {
        userId: inviterId,
        credentialId: "ya-registrada",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "La de Ana",
      },
    });
    const { token } = await createInvitation(inviterId);
    const result = await redeemInvitation({
      token,
      email: "luis@example.com",
      credential: {
        credentialId: "ya-registrada",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "La de Luis",
      },
    });
    expect(result).toEqual({ ok: false, reason: "credential-taken" });
    // And since it fires inside the transaction, the invitation is not spent
    // either.
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
    expect(await newUsers()).toBe(0);
  });
});

// Closing the session of a lost phone — bumping token_version — does not touch
// the invitations that session created: they stayed alive for up to 72 hours,
// with no way to see them or to withdraw them.
describe("seeing and withdrawing invitations", () => {
  it("records who came in through each link", async () => {
    const { token } = await createInvitation(inviterId);
    const redemption = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(redemption.ok).toBe(true);

    const [row] = await listInvitations();
    expect(row.state).toBe("redeemed");
    expect(row.createdByEmail).toBe("ana@example.com");
    expect(row.redeemedByEmail).toBe("luis@example.com");
  });

  it("also when the account was created with a passkey", async () => {
    const { token } = await createInvitation(inviterId);
    await redeemInvitation({
      token,
      email: "luis@example.com",
      credential: {
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "un teléfono",
      },
    });
    const [row] = await listInvitations();
    expect(row.redeemedByEmail).toBe("luis@example.com");
  });

  it("the list carries neither the token nor its hash anywhere", async () => {
    await createInvitation(inviterId);
    const [row] = await listInvitations();
    expect(Object.keys(row)).not.toContain("tokenHash");
    expect(JSON.stringify(row)).not.toContain("tokenHash");
  });

  it("revoking kills the link: whoever holds it can no longer redeem it", async () => {
    const { token } = await createInvitation(inviterId);
    const [row] = await listInvitations();
    expect(row.state).toBe("pending");

    expect(await revokeInvitation(row.id)).toBe(true);
    expect((await listInvitations())[0].state).toBe("revoked");
    expect(
      await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      }),
    ).toEqual({ ok: false, reason: "used" });
    expect(await newUsers()).toBe(0);
  });

  it("revoking an already used one does not go through and does not erase who came in", async () => {
    const { token } = await createInvitation(inviterId);
    await redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" });
    const [row] = await listInvitations();

    expect(await revokeInvitation(row.id)).toBe(false);
    const after = (await listInvitations())[0];
    expect(after.state).toBe("redeemed");
    expect(after.redeemedByEmail).toBe("luis@example.com");
    expect(after.usedAt).toEqual(row.usedAt);
  });

  it("revoking something that does not exist does not go through", async () => {
    expect(await revokeInvitation("no-es-un-id")).toBe(false);
  });

  it("an unused expired one shows as expired, not as revoked", async () => {
    await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await listInvitations())[0].state).toBe("expired");
  });

  // Revoking and redeeming write the SAME column with the same conditional
  // UPDATE, so Postgres decides between them and not the order in which two
  // handlers happened to read. If revocation lived in a separate column, this
  // would return true: it would have "revoked" an invitation that at that very
  // instant was creating an account, and the household would have a member its
  // own record treats as never admitted.
  it("a revocation arriving with the redemption in flight does not go through", async () => {
    const { token } = await createInvitation(inviterId);
    const tokenHash = hashInvitationToken(token);
    const [row] = await listInvitations();

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const hasEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });

    // The redemption, held back right after taking the row.
    const redemption = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
      entered();
      await held;
    });

    await hasEntered;
    const revocation = revokeInvitation(row.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await redemption;

    expect(await revocation).toBe(false);
  });
});
