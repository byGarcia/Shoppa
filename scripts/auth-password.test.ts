import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { authorizePassword } from "../src/lib/auth-password.ts";
import { normalizeEmail as normalizeEmailApp } from "../src/lib/email.ts";
import { MIN_PASSWORD_LENGTH, verifyPassword } from "../src/lib/password.ts";
import { prisma } from "../src/server/db.ts";
import { findAccount, normalizeEmail, readLineFrom, resetPassword } from "./auth-password.mjs";
import { getClient } from "./lib/db.mjs";

const ETX = String.fromCharCode(3); // Ctrl-C
const EOT = String.fromCharCode(4); // Ctrl-D
const ESC = String.fromCharCode(27); // Start of the arrow keys
const DEL = String.fromCharCode(127); // Backspace

const EMAIL = "rescate-tarea14@example.com";
const LONG_PASSWORD = "una contraseña larga";

let client: Client;

beforeAll(async () => {
  client = await getClient();
});

afterAll(async () => {
  await client.end();
});

afterEach(async () => {
  // `insensitive`, because one of the cases below stores the address in mixed
  // case on purpose and `contains` is case-sensitive in Postgres: without this
  // that row survives the suite and stays in the development database.
  await prisma.securityLog.deleteMany({
    where: { email: { contains: "rescate-tarea14", mode: "insensitive" } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: "rescate-tarea14", mode: "insensitive" } },
  });
});

async function createUser(email = EMAIL, passwordHash: string | null = null) {
  return prisma.user.create({ data: { email, passwordHash, tokenVersion: 3 } });
}

describe("rescue normalizeEmail", () => {
  // The script cannot import src/lib/email.ts — `src/lib` is not in the runner
  // image — so the rule exists twice. This is what stops the copies drifting:
  // if one of them starts stripping dots or handling +tags, the rescue and the
  // login would look up different rows and only one of them would say so.
  it("answers exactly the same as the application's", () => {
    const samples = [
      "ana@example.com",
      "Ana@Example.COM",
      "  ana@example.com  ",
      "\tANA@EXAMPLE.COM\n",
      "Ana.Garcia+compra@Example.com",
      "",
      "   ",
      "sin-arroba",
      "MAYÚSCULAS@example.com",
    ];
    for (const sample of samples) {
      expect(normalizeEmail(sample)).toBe(normalizeEmailApp(sample));
    }
  });
});

describe("readLineFrom", () => {
  it("waits while the newline has not arrived", () => {
    expect(readLineFrom("medio")).toEqual({ status: "incomplete", value: "medio", rest: "" });
  });

  it("cuts at the newline and returns the rest", () => {
    // The regression that cost a whole run: pasting the password and its repeat
    // sends both of them in a single chunk. Throwing away what comes after the
    // newline left the second prompt with nothing to read.
    expect(readLineFrom("clave\nrepetida\n")).toEqual({
      status: "line",
      value: "clave",
      rest: "repetida\n",
    });
  });

  it("treats CRLF as a single line ending, not as an empty line behind it", () => {
    expect(readLineFrom("clave\r\notra")).toEqual({
      status: "line",
      value: "clave",
      rest: "otra",
    });
  });

  it("applies the deletion", () => {
    expect(readLineFrom(`clavv${DEL}e\n`).value).toBe("clave");
    expect(readLineFrom(`${DEL}${DEL}clave\n`).value).toBe("clave");
  });

  it("does not let an arrow key get into the password", () => {
    // Dropping only the ESC — what an "ignore the control characters" rule
    // does — would leave "[C" inside the password, invisible to whoever types
    // it and fatal for whoever tries to log in with it later.
    expect(readLineFrom(`cla${ESC}[Cve\n`).value).toBe("clave");
    expect(readLineFrom(`cla${ESC}[1;5Dve\n`).value).toBe("clave");
    expect(readLineFrom(`cla${ESC}OPve\n`).value).toBe("clave");
  });

  it("a lone ESC does not eat the next character", () => {
    expect(readLineFrom(`cla${ESC}ve\n`).value).toBe("clave");
  });

  it("cancels on Ctrl-C and on Ctrl-D instead of accepting the part already typed", () => {
    expect(readLineFrom(`media${ETX}`)).toEqual({ status: "cancelled", value: "", rest: "" });
    expect(readLineFrom(`media${EOT}`)).toEqual({ status: "cancelled", value: "", rest: "" });
  });

  it("counts an accent as one character and not as its two bytes", () => {
    expect(readLineFrom("contraseña\n").value).toBe("contraseña");
    expect(readLineFrom(`contraseña${DEL}\n`).value).toBe("contraseñ");
  });

  it("deletes the whole emoji and not half a surrogate pair", () => {
    // A plain slice would split the pair and leave an orphan surrogate inside
    // the password that nobody could ever type again.
    expect(readLineFrom(`clave🔑${DEL}\n`).value).toBe("clave");
    expect(readLineFrom("clave🔑\n").value).toBe("clave🔑");
  });
});

describe("findAccount", () => {
  it("finds the account and says whether it already had a password", async () => {
    await createUser(EMAIL, "scrypt$N=65536,r=8,p=1$c2FsdA==$a2V5");
    const account = await findAccount(client, EMAIL);
    expect(account?.email).toBe(EMAIL);
    expect(account?.hasPassword).toBe(true);
    expect(account?.passkeys).toBe(0);
  });

  it("tells apart the account with no password, which is the one the rescue exists to save", async () => {
    await createUser();
    expect((await findAccount(client, EMAIL))?.hasPassword).toBe(false);
  });

  it("counts the passkeys, which the rescue does not touch", async () => {
    const user = await createUser();
    await prisma.webAuthnCredential.create({
      data: {
        userId: user.id,
        credentialId: "cred-rescate-tarea14",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Móvil",
      },
    });
    expect((await findAccount(client, EMAIL))?.passkeys).toBe(1);
  });

  it("returns null when that address does not exist", async () => {
    expect(await findAccount(client, "rescate-tarea14-nadie@example.com")).toBeNull();
  });
});

describe("resetPassword", () => {
  it("writes a hash that verifies the password just typed", async () => {
    await createUser();
    await resetPassword(client, EMAIL, LONG_PASSWORD);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.passwordHash).not.toBeNull();
    expect(row.passwordHash).not.toContain(LONG_PASSWORD);
    expect(await verifyPassword(LONG_PASSWORD, row.passwordHash as string)).toBe(true);
  });

  it("bumps token_version in the same statement: without that the previous holder stays in", async () => {
    await createUser();
    const result = await resetPassword(client, EMAIL, LONG_PASSWORD);
    expect(result?.tokenVersion).toBe(4);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.tokenVersion).toBe(4);
  });

  it("normalizes the address, so the uppercase its owner types still works", async () => {
    await createUser();
    const result = await resetPassword(client, "  RESCATE-Tarea14@Example.COM  ", LONG_PASSWORD);
    expect(result?.email).toBe(EMAIL);
  });

  it("really does rescue a row stored unnormalized", async () => {
    // Finding the row is not enough, and it is worse than not finding it,
    // because a success that is not one gets reported: the login looks up by
    // exact equality (src/lib/auth-password.ts), so writing the hash onto
    // `Rescate-Tarea14-Legado@Example.com` and leaving the spelling as it was
    // leaves an account with a new password that nobody can get into. That is
    // why this test really logs in instead of looking at the row.
    await createUser("Rescate-Tarea14-Legado@Example.com");
    const result = await resetPassword(client, "Rescate-Tarea14-Legado@Example.com", LONG_PASSWORD);
    expect(result?.email).toBe("rescate-tarea14-legado@example.com");

    const signIn = await authorizePassword("rescate-tarea14-legado@example.com", LONG_PASSWORD);
    expect(signIn.ok).toBe(true);
  });

  it("normalizing the spelling changes nothing for a row that already was", async () => {
    await createUser();
    await resetPassword(client, EMAIL, LONG_PASSWORD);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.email).toBe(EMAIL);
    expect((await authorizePassword(EMAIL, LONG_PASSWORD)).ok).toBe(true);
  });

  it("returns null when there is no row, instead of saying it went fine", async () => {
    expect(await resetPassword(client, "rescate-tarea14-nadie@example.com", LONG_PASSWORD)).toBeNull();
  });

  it("leaves a durable trace in security_logs, which is all that is left of the rescue", async () => {
    // Without this row, the entire record of somebody rewriting a credential
    // with no session and without authenticating is the error output of a
    // terminal.
    const user = await createUser();
    const result = await resetPassword(client, EMAIL, LONG_PASSWORD);
    expect(result?.audited).toBe(true);

    const event = await prisma.securityLog.findFirstOrThrow({ where: { userId: user.id } });
    expect(event.eventType).toBe("PASSWORD_RESET");
    expect(event.severity).toBe("WARNING");
    expect(event.email).toBe(EMAIL);
    expect(event.endpoint).toBe("scripts/auth-password.mjs");
    expect(event.success).toBe(true);
  });

  it("puts neither the password nor the hash into the trace", async () => {
    await createUser();
    await resetPassword(client, EMAIL, LONG_PASSWORD);
    const event = await prisma.securityLog.findFirstOrThrow({ where: { email: EMAIL } });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(LONG_PASSWORD);
    expect(serialized).not.toContain(row.passwordHash as string);
  });

  it("a trace that cannot be written does not undo the rescue", async () => {
    // The other way round would be worse than what it fixes: a broken enum or a
    // full disk would turn "you cannot get in" into "you cannot get in and you
    // cannot fix it either".
    await createUser();
    await client.query('ALTER TABLE security_logs RENAME TO "security_logs_tarea14"');
    try {
      const result = await resetPassword(client, EMAIL, LONG_PASSWORD);
      expect(result?.audited).toBe(false);
      expect(result?.tokenVersion).toBe(4);
      const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(await verifyPassword(LONG_PASSWORD, row.passwordHash as string)).toBe(true);
    } finally {
      await client.query('ALTER TABLE "security_logs_tarea14" RENAME TO security_logs');
    }
  });

  it("rejects anything below the minimum without touching the row", async () => {
    await createUser();
    await expect(resetPassword(client, EMAIL, "corta")).rejects.toThrow(
      new RegExp(String(MIN_PASSWORD_LENGTH)),
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(row.passwordHash).toBeNull();
    expect(row.tokenVersion).toBe(3);
  });
});
