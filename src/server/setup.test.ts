import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "./db.ts";
import { claimInstance, isClaimed, setupToken } from "./setup.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    AUTH_SECRET: "test-secret-long-enough",
    SETUP_TOKEN: undefined,
  };
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
  await prisma.instanceSetup.upsert({
    where: { id: "singleton" },
    update: { claimedAt: null },
    create: { id: "singleton" },
  });
});

// The defect this block pins down was invisible to every unit test: `let token`
// memoises per MODULE INSTANCE, and Next compiles the middleware bundle apart
// from the route bundles, so the module gets instantiated more than once in the
// same process and each copy drew its own random value. Startup printed one
// token and /api/setup checked a different one: an instance useless from the
// first minute. Reloading the module is how that is reproduced here.
describe("the setup token", () => {
  async function tokenFromAFreshCopy(): Promise<string> {
    vi.resetModules();
    const imported = await import("./setup.ts");
    return imported.setupToken();
  }

  it("two copies of the module give the same token: not memoised, derived", async () => {
    process.env.AUTH_SECRET = "test-secret-long-enough";
    expect(await tokenFromAFreshCopy()).toBe(await tokenFromAFreshCopy());
  });

  it("changes if AUTH_SECRET changes, and does not reveal it", async () => {
    process.env.AUTH_SECRET = "a-secret";
    const a = await tokenFromAFreshCopy();
    process.env.AUTH_SECRET = "another-secret";
    const b = await tokenFromAFreshCopy();
    expect(a).not.toBe(b);
    expect(a).not.toContain("a-secret");
  });

  it("an explicit SETUP_TOKEN wins over the derivation", async () => {
    process.env.SETUP_TOKEN = "mine";
    expect(await tokenFromAFreshCopy()).toBe("mine");
  });

  it("with neither AUTH_SECRET nor SETUP_TOKEN it throws naming the variable", async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.SETUP_TOKEN;
    await expect(tokenFromAFreshCopy()).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("claiming the instance", () => {
  it("an instance with no users is unclaimed", async () => {
    expect(await isClaimed()).toBe(false);
  });

  it("rejects a wrong setup token", async () => {
    const result = await claimInstance({
      token: "not-the-token",
      email: "ana@example.com",
      password: "a long enough password",
    });
    expect(result).toEqual({ ok: false, reason: "bad-token" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates the user and marks the claim", async () => {
    const result = await claimInstance({
      token: setupToken(),
      email: "ana@example.com",
      password: "a long enough password",
    });
    expect(result.ok).toBe(true);
    expect(await isClaimed()).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it("of two simultaneous claims only one succeeds, and no half user is left behind", async () => {
    const token = setupToken();
    const [a, b] = await Promise.all([
      claimInstance({ token, email: "ana@example.com", password: "a long enough password" }),
      claimInstance({ token, email: "luis@example.com", password: "another long enough password" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
  });

  // The Promise.all above depends on the two transactions actually overlapping,
  // and does not guarantee it: the scrypt that runs first introduces jitter and
  // the first transaction's window is a couple of milliseconds. This test forces
  // the overlap — it holds a transaction open with the row locked while the real
  // claim arrives — and it is the one that proves the guarantee: the second one
  // sits waiting on the lock and, once it is released, its conditional UPDATE
  // matches zero rows. A "count and then decide" would read claimed_at NULL from
  // the pre-commit snapshot and create the user regardless.
  it("a claim that arrives with the row locked by another transaction does not succeed", async () => {
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
        UPDATE instance_setup SET claimed_at = now()
        WHERE id = 'singleton' AND claimed_at IS NULL`;
      entered();
      await held;
    });

    await hasEntered;
    const late = claimInstance({
      token: setupToken(),
      email: "luis@example.com",
      password: "another long enough password",
    });
    // Plenty of time for the late claim's UPDATE to reach the lock.
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await holder;

    expect(await late).toEqual({ ok: false, reason: "already-claimed" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("once claimed, it is not claimed again", async () => {
    const token = setupToken();
    await claimInstance({ token, email: "ana@example.com", password: "a long enough password" });
    const second = await claimInstance({
      token,
      email: "luis@example.com",
      password: "another long enough password",
    });
    expect(second).toEqual({ ok: false, reason: "already-claimed" });
  });

  // The CHECK keeps the instance_setup row unique, not mandatory: after a DELETE
  // the conditional UPDATE silently matches zero rows. Zero rows means "I did not
  // get the claim", never "the row was already there and is still there".
  it("with no instance_setup row nothing is claimed and no user is created", async () => {
    await prisma.instanceSetup.deleteMany();
    const result = await claimInstance({
      token: setupToken(),
      email: "ana@example.com",
      password: "a long enough password",
    });
    expect(result.ok).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });

  it("stores the email lowercased and without surrounding spaces", async () => {
    const result = await claimInstance({
      token: setupToken(),
      email: "  Ana@Example.COM  ",
      password: "a long enough password",
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findFirst({ select: { email: true } });
    expect(user?.email).toBe("ana@example.com");
  });

  it("a claim made with a credential stores no password hash", async () => {
    const result = await claimInstance({
      token: setupToken(),
      email: "ana@example.com",
      password: "a long enough password",
      credential: {
        credentialId: "test-credential",
        publicKey: "public-key",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Test device",
      },
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findFirst({ select: { passwordHash: true } });
    expect(user?.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  // The migration fills claimed_at only for the users that existed when it ran,
  // and any row written into users outside the claim path — a restore, a
  // hand-written INSERT — leaves the mark untouched. In that state — users yes,
  // mark no — the "not claimed" gate sent the whole household to /setup and
  // opened a sign-up window for a visitor right next to the accounts that
  // already existed.
  it("with users and no mark, the instance counts as claimed", async () => {
    await prisma.user.create({ data: { email: "importada@example.com" } });
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: null } });
    expect(await isClaimed()).toBe(true);
  });

  it("with users and no mark, a good token does not create a second account", async () => {
    await prisma.user.create({ data: { email: "importada@example.com" } });
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: null } });
    const result = await claimInstance({
      token: setupToken(),
      email: "intrusa@example.com",
      password: "a long enough password",
    });
    expect(result).toEqual({ ok: false, reason: "already-claimed" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("without password or credential nothing is created and the instance stays unclaimed", async () => {
    const result = await claimInstance({ token: setupToken(), email: "ana@example.com" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(await isClaimed()).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });
});
