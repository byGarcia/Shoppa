#!/usr/bin/env node
/**
 * Password rescue. The only way back into an instance whose single passkey is
 * gone, which is the consequence of deleting the password when a passkey is
 * registered.
 *
 * Plain Node with no pnpm and no package scripts, because the runner image has
 * neither:
 *   docker compose exec app node scripts/auth-password.mjs ana@example.com
 *
 * Bumping tokenVersion is not decoration: it kills the sessions of whoever was
 * using the account before the reset.
 *
 * Three constraints shape every import in this file, and each of them is a
 * `Cannot find module` at the worst possible moment if it is forgotten:
 *
 *  1. The runner stage copies `node_modules`, `.next`, `public`, `prisma`,
 *     `ops`, `scripts/lib`, this file and `src/env-local.ts`. It does not copy
 *     `src/lib` or `src/server`, so nothing under `src/lib` can be imported
 *     from here.
 *  2. Plain `node` does not read tsconfig paths, so the `@/` alias is a
 *     fiction outside the bundler.
 *  3. The Prisma client is generated into `src/generated/prisma` and never
 *     reaches the image. Postgres is reached through `pg`, a production
 *     dependency, exactly as `prisma/seed.ts` does and for the same reason.
 *
 * The environment is read from the process, never from a file. In the container
 * DATABASE_URL is already there; on a workstation the `auth:password` alias
 * supplies `.env.local` with `--env-file-if-exists`, which keeps the real
 * environment winning over the file the way src/env-local.ts does.
 */
import { hostname, userInfo } from "node:os";
import { pathToFileURL } from "node:url";

import { getClient } from "./lib/db.mjs";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./lib/password.mjs";

/**
 * The same spelling rule as src/lib/email.ts, which this file cannot import:
 * `src/lib` is not in the image. Addresses are stored lowercase and every
 * lookup normalises, so a rescue that skipped this step would fail to find
 * `Ana@example.com` typed with the capital its owner uses.
 *
 * scripts/auth-password.test.ts pins the two implementations together, because
 * a rule written twice is a rule that drifts.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeEmail(raw) {
  return raw.trim().toLowerCase();
}

/**
 * What the operator is about to overwrite. Read before prompting so that a
 * misspelled address costs nothing but a second attempt, rather than a password
 * typed twice into a rescue that was never going to land.
 *
 * @param {import("pg").Client} client
 * @param {string} email already normalised
 * @returns {Promise<{ id: string, email: string, hasPassword: boolean, passkeys: number } | null>}
 */
export async function findAccount(client, email) {
  // lower(email) rather than a plain equality: the 20260902190000 migration
  // lowercased what was stored and added a unique index on this very
  // expression, but a row written before it can still hold an address in mixed
  // case. The index makes this exact, not a scan, and the worst outcome for a
  // rescue tool is refusing to find an account that is right there.
  //
  // Finding such a row is only half of it, and the half that is worthless on
  // its own: the sign-in looks the address up by exact equality
  // (src/lib/auth-password.ts:48 does findUnique on the normalised string), so
  // a rescue that wrote a hash onto `Legacy@Example.com` and left the spelling
  // alone would report success and leave nobody able to sign in. `resetPassword`
  // normalises the column in the same UPDATE for that reason.
  const found = await client.query(
    `SELECT u.id,
            u.email,
            u.password_hash IS NOT NULL AS has_password,
            (SELECT count(*) FROM webauthn_credentials w WHERE w.user_id = u.id) AS passkeys
       FROM users u
      WHERE lower(u.email) = $1`,
    [email],
  );
  const row = found.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    hasPassword: row.has_password,
    passkeys: Number(row.passkeys),
  };
}

/**
 * The durable trace. Best effort, on the connection that just did the work.
 *
 * The rescue is the only path in this product that writes a credential with no
 * session and no authentication behind it, so without this row the entire
 * record of it is stderr in somebody's terminal — gone the moment the window
 * closes. src/server/security-log.ts says the same thing about the passkey
 * events and cannot be used here: it is `server-only` and it goes through
 * Prisma.
 *
 * WARNING rather than INFO. Every other row in this table records something an
 * authenticated request did; this one records a credential rewritten from
 * outside the application entirely, and it is the row somebody scanning the
 * table is looking for.
 *
 * Deliberately NOT in a transaction with the UPDATE. If the audit insert could
 * roll the rescue back, a broken enum or a full disk would turn "you cannot get
 * in" into "you cannot get in, and you cannot fix it either".
 *
 * Neither the password nor the hash goes anywhere near `details`.
 *
 * @param {import("pg").Client} client
 * @param {{ id: string, email: string, tokenVersion: number }} row
 * @returns {Promise<boolean>} false when the row did not land
 */
async function recordRescue(client, row) {
  try {
    await client.query(
      `INSERT INTO security_logs
         (id, event_type, severity, user_id, email, endpoint, success, details, created_at)
       VALUES (gen_random_uuid()::text, 'PASSWORD_RESET', 'WARNING', $1, $2, $3, true, $4, now())`,
      [
        row.id,
        row.email,
        "scripts/auth-password.mjs",
        // The host and the account that ran it are the only "who" available:
        // there is no request, so no address and no user agent either.
        JSON.stringify({
          tokenVersion: row.tokenVersion,
          host: hostname(),
          user: userInfo().username,
        }),
      ],
    );
    return true;
  } catch (error) {
    console.error(
      `[rescue] could not record the security event: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * Hash and write, with `token_version` incremented in the same statement.
 *
 * One statement, not two: whoever was using this account before the reset stays
 * signed in until `token_version` moves, and src/lib/auth.ts compares the JWT's
 * copy against the stored one on every request. A rescue that wrote the hash
 * and left the counter alone would hand a working instance back to the person
 * it was meant to lock out.
 *
 * `updated_at` is set by hand because `@updatedAt` is a Prisma-client
 * behaviour, and the client is not here.
 *
 * @param {import("pg").Client} client
 * @param {string} rawEmail normalised internally, so no caller can forget to
 * @param {string} plain
 * @returns {Promise<{ email: string, tokenVersion: number, audited: boolean } | null>}
 * null when no row matched
 */
export async function resetPassword(client, rawEmail, plain) {
  const email = normalizeEmail(rawEmail);
  // Before the UPDATE: a password below the minimum must not leave a half-done
  // rescue behind, and hashPassword is the one place that decides the minimum.
  const passwordHash = await hashPassword(plain);
  // `email = lower(btrim(email))` is the third thing this statement writes, and
  // it is not tidying. Without it a row stored before that migration as
  // `Legacy@Example.com` gets a hash it can never use — the sign-in matches by
  // exact equality against the normalised string — and the rescue reports
  // success while nobody can get in. It is the same expression the
  // 20260902190000 migration used and the one `users_email_lower_key` is built
  // on, so it cannot collide, and it is a no-op for every row already
  // normalised, which is all of them but those.
  const updated = await client.query(
    `UPDATE users
        SET password_hash = $1,
            token_version = token_version + 1,
            email = lower(btrim(email)),
            updated_at = now()
      WHERE lower(email) = $2
      RETURNING id, email, token_version`,
    [passwordHash, email],
  );
  const row = updated.rows[0];
  if (!row) return null;
  const audited = await recordRescue(client, {
    id: row.id,
    email: row.email,
    tokenVersion: row.token_version,
  });
  return { email: row.email, tokenVersion: row.token_version, audited };
}

/** Ctrl-C at the prompt. Raw mode swallows SIGINT, so it arrives as a value. */
class Cancelled extends Error {}

// The keystrokes raw mode hands over as data instead of acting on. Written by
// code point rather than as literals, which are invisible in a diff.
const ETX = String.fromCharCode(3); // Ctrl-C
const EOT = String.fromCharCode(4); // Ctrl-D
const ESC = String.fromCharCode(27); // The start of every arrow and function key
const DEL = String.fromCharCode(127); // Backspace, on most terminals
const BS = String.fromCharCode(8); // Backspace, on the rest

/**
 * Takes one edited line off the front of raw terminal input.
 *
 * Pure, and separate from the prompt, because the terminal is what makes this
 * awkward to test and none of the decisions here need one. `rest` is the point:
 * a terminal delivers chunks, not lines, and somebody who pastes the password
 * and its confirmation in one go sends both in a single chunk. An earlier
 * version dropped whatever followed the newline, so the second prompt had
 * nothing left to read and the run ended in "cancelado" with the password
 * already typed.
 *
 * @param {string} raw everything received since the prompt was printed
 * @returns {{ status: "line" | "incomplete" | "cancelled", value: string, rest: string }}
 */
export function readLineFrom(raw) {
  let value = "";
  const chars = [...raw]; // whole code points, so an accented character is one unit
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === "\r" || ch === "\n") {
      // A CRLF is one line ending, not an empty line after it.
      const from = ch === "\r" && chars[i + 1] === "\n" ? i + 2 : i + 1;
      return { status: "line", value, rest: chars.slice(from).join("") };
    }
    // Ctrl-C and Ctrl-D both mean "stop", and neither may be read as the end of
    // a password: accepting what was typed so far would write a truncated one
    // and report success.
    if (ch === ETX || ch === EOT) return { status: "cancelled", value: "", rest: "" };
    if (ch === DEL || ch === BS) {
      // By code point, not by `slice(0, -1)`: a plain slice would cut an emoji
      // in half and leave a lone surrogate inside the password, which nobody
      // could ever type again.
      value = [...value].slice(0, -1).join("");
      continue;
    }
    if (ch === ESC) {
      // An arrow or function key arrives as ESC, then `[` or `O`, then
      // parameter bytes, then a final one. Dropping only the ESC — which is
      // what a bare "ignore control characters" rule does — would leave `[C`
      // sitting inside the password, and nobody would ever see it there.
      let j = i + 1;
      if (chars[j] === "[" || chars[j] === "O") {
        j += 1;
        while (j < chars.length && chars[j] >= " " && chars[j] <= "?") j += 1;
        if (j < chars.length) j += 1; // the final byte
      }
      i = j - 1; // the loop's own increment lands on the next real character
      continue;
    }
    // Everything else below U+0020 is a control character. Silently dropping
    // them keeps a stray keypress out of the password instead of into it.
    if (ch >= " ") value += ch;
  }
  return { status: "incomplete", value, rest: "" };
}

/** Input that arrived after the newline that ended the previous prompt. */
let pending = "";

/**
 * Reads a line from the terminal without echoing it.
 *
 * Never `process.argv`: an argument lands in the shell history and in `ps`,
 * where any other user on the host reads it at leisure. Raw mode is what turns
 * the echo off, which is also why Ctrl-C has to be handled here — in raw mode
 * the terminal stops turning it into a signal.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
function promptHidden(question) {
  const input = process.stdin;
  const output = process.stderr;
  return new Promise((resolve, reject) => {
    output.write(question);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");

    // Whatever the previous prompt read past its newline belongs to this one.
    let raw = pending;
    pending = "";

    /** @param {Error | null} error @param {string} value */
    const settle = (error, value) => {
      input.removeListener("data", onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    /** @returns {boolean} true when the promise has been settled */
    const step = () => {
      const read = readLineFrom(raw);
      if (read.status === "incomplete") return false;
      pending = read.rest;
      settle(read.status === "cancelled" ? new Cancelled() : null, read.value);
      return true;
    };

    /** @param {string} chunk */
    const onData = (chunk) => {
      // The whole buffer is re-read on every chunk rather than edited in place.
      // Passwords are short and `readLineFrom` is pure, so this is the cheap
      // way to have one place that decides what a backspace does.
      raw += chunk;
      step();
    };

    if (raw && step()) return;
    input.on("data", onData);
  });
}

const USAGE = `Usage: node scripts/auth-password.mjs <email>

Sets a new password on an account that already exists and closes its open
sessions. The password is typed at the prompt below, without echo.

  docker compose exec app node scripts/auth-password.mjs ana@example.com`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1 || args[0] === "-h" || args[0] === "--help") {
    // Two arguments almost always means the password was typed on the command
    // line, so the refusal says why instead of just repeating the usage: it has
    // already been written to the shell history by the time this runs.
    if (args.length > 1) {
      console.error(
        "[rescue] the password is NOT passed as an argument: it stays in the shell history " +
          "and in plain sight of anyone running `ps`. It is typed at the prompt, without echo.\n",
      );
    }
    console.error(USAGE);
    return args[0] === "-h" || args[0] === "--help" ? 0 : 2;
  }

  const email = normalizeEmail(args[0]);
  if (!email.includes("@")) {
    console.error(`[rescue] "${args[0]}" does not look like an email address.`);
    return 2;
  }

  if (!process.stdin.isTTY) {
    // `docker exec` without -it, or a pipe. There is no way to turn the echo
    // off on something that is not a terminal, and reading the password from a
    // pipe would be the argv problem wearing a different hat.
    console.error(
      "[rescue] a terminal is needed to type the password without echo.\n" +
        "         With Docker that is the two letters: `docker compose exec` allocates one,\n" +
        "         `docker exec` needs `-it`.",
    );
    return 2;
  }

  const client = await getClient();
  try {
    const account = await findAccount(client, email);
    if (!account) {
      // Said plainly, with the address as it was understood. This is a local
      // operator with the database in front of them: hiding whether the account
      // exists would protect nobody and would turn a typo into a mystery.
      console.error(
        `[rescue] there is no account with the email ${email}. Nothing was changed.`,
      );
      return 1;
    }

    console.error(`[rescue] account ${account.email}.`);
    console.error(
      account.hasPassword
        ? "[rescue] it has a password: it is replaced by the new one."
        : "[rescue] it has no password: one is being set.",
    );
    if (account.passkeys > 0) {
      console.error(
        `[rescue] it keeps ${account.passkeys} passkey(s): this does not touch them, it only ` +
          "adds another way in.",
      );
    }

    const password = await promptHidden(
      `New password for ${account.email} (at least ${MIN_PASSWORD_LENGTH} characters): `,
    );
    if (password.length < MIN_PASSWORD_LENGTH) {
      // hashPassword refuses this too, and it is the one place that decides the
      // minimum. Checking here as well is not a second rule: it is the
      // difference between a sentence and a stack trace, and it stops a second
      // prompt that was never going to be worth typing.
      console.error(
        `[rescue] the password needs at least ${MIN_PASSWORD_LENGTH} characters. ` +
          "Nothing was changed.",
      );
      return 1;
    }

    const again = await promptHidden("Repeat the password: ");
    if (again !== password) {
      console.error("[rescue] the two passwords do not match. Nothing was changed.");
      return 1;
    }

    const result = await resetPassword(client, email, password);
    if (!result) {
      // The account was there a moment ago, so somebody deleted it in between.
      console.error(
        `[rescue] the account ${email} stopped existing while the password was being typed. ` +
          "Nothing was changed.",
      );
      return 1;
    }

    console.error(`[rescue] password updated for ${result.email}.`);
    if (result.email !== account.email) {
      // Only rows written before the normalising migration. Said out loud
      // because the address the operator was looking at a moment ago has just
      // changed spelling.
      console.error(
        `[rescue] the address was stored as ${account.email} and is now normalised to ` +
          `${result.email}, which is the spelling that signs in.`,
      );
    }
    console.error(
      `[rescue] token_version = ${result.tokenVersion}: any session open with this account ` +
        "is now closed.",
    );
    // The scenario this script exists for ends in five failed sign-ins, and
    // five failed sign-ins are exactly what arms the per-account throttle. That
    // counter lives in the memory of the Next server (src/lib/login-throttle.ts)
    // and this is a separate process, so nothing here can clear it: without
    // this warning the operator types the new password, is refused, and has no
    // way to tell a throttle from a rescue that did not work.
    console.error(
      "[rescue] NOTE: five failed sign-ins in a row arm a 15-minute throttle on this\n" +
        "         account, and this script CANNOT clear it: the counter lives in the running\n" +
        "         server's memory and this is another process. If the new password is refused,\n" +
        "         either wait out the window — it runs from the FIRST failure, not the fifth —\n" +
        "         or restart the container, which resets every counter.",
    );
    if (result.audited) {
      console.error("[rescue] recorded in security_logs as PASSWORD_RESET.");
    } else {
      // The rescue itself worked; only its trace did not. Reporting failure
      // here would be a lie, and a lie that sends somebody to run it again.
      console.error(
        "[rescue] WARNING: the password WAS changed, but the event could not be recorded " +
          "in security_logs. This rescue leaves no trace beyond these lines: write it down " +
          "wherever such things are written down.",
      );
    }
    if (process.env.AUTH_MODE === "passkey") {
      // Otherwise the rescue looks like it worked and the login still refuses:
      // src/lib/auth-password.ts turns the whole password branch off in this
      // mode, and nothing on the sign-in screen explains why.
      console.error(
        "[rescue] WARNING: AUTH_MODE=passkey, so this instance does not accept signing in " +
          "with a password. Remove that variable (or set it to auto) and restart to use it.",
      );
    }
    return 0;
  } finally {
    // Without this the process never exits.
    await client.end();
  }
}

// Only when invoked directly, so the tests can import the pieces above without
// opening a connection or grabbing the terminal.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof Cancelled) {
      console.error("[rescue] cancelled. Nothing was changed.");
      process.exitCode = 130;
    } else {
      console.error(`[rescue] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
