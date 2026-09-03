# Contributing to Shoppa

Thanks for being here. Shoppa is a small, deliberately narrow application: a shared shopping list
and a price watcher, for one household per instance. Before proposing a feature, read
[PRODUCT.md](PRODUCT.md) — it says what Shoppa owns, what it refuses to become and what has been
left for later on purpose. A change that moves the boundary is a conversation in an issue before it
is a pull request.

Bug fixes, documentation and translations need no permission. Open the pull request.

---

## Running it locally

**You need Node 24, 25 or 26, pnpm 11.13.0, and Docker with the Compose plugin.** Both versions are
pinned in `package.json`, and the easiest way to get the right pnpm is `corepack enable` — which is
what the Dockerfile does. Older Node is not a preference: `pnpm install` fails with `EBADENGINE`,
and `pnpm db:seed` runs `prisma/seed.ts` through `node` directly, which needs the TypeScript
stripping Node only does by itself from 24.

Development reads **`.env.local`**, not `.env`. That is where `prisma.config.ts`, the seed and the
test runner all look, and none of them read `.env` — which is Compose's file, for a deployment.
Create it first, or every Prisma command stops at `Cannot resolve environment variable:
DATABASE_URL`.

From a clean checkout:

```bash
pnpm install

cat > .env.local <<'EOF'
DATABASE_URL=postgresql://shopping:shopping_dev@127.0.0.1:5437/shopping
APP_ORIGIN=http://localhost:3004
AUTH_SECRET=dev-secret-long-enough-to-sign-things
EOF

pnpm db:up        # PostgreSQL from compose.dev.yaml, on 127.0.0.1:5437
pnpm db:generate  # the Prisma client, into the gitignored src/generated/
pnpm db:deploy    # apply the migrations
pnpm db:seed      # the twelve factory categories and the dictionary

pnpm dev          # http://localhost:3004
```

`pnpm db:generate` is not optional on a fresh clone: `src/generated/` is gitignored, so without it
`typecheck`, `test`, `build` and `dev` all fail on a missing module.

`compose.dev.yaml` starts the database and nothing else, on a loopback port with a throwaway
password. `compose.yaml` is the one that installs Shoppa; the two are not interchangeable.

The first page you ask for lands on `/setup`, and asking for it is also what makes the server print
the install token. So ask for the page first, **then** read the terminal `pnpm dev` is running in:
the line begins `[setup] installation token:`. Paste it, pick an email and a password of at least 12
characters, and you have an account.

To stop the database: `pnpm db:down`. It keeps the volume.

### Tests

```bash
pnpm test    # vitest
pnpm check   # lint, typecheck, i18n, tests, build — the whole gate
```

The suite runs against that same development database and mutates it on purpose; there is no
separate test database. `pnpm db:seed` is idempotent and additive, so re-running it after a suite is
harmless and is the way back to a known state.

---

## Conventions this codebase enforces

These are not style preferences. Each one has a check behind it or a reason written down.

- **English everywhere a reader looks: comments, identifiers and test descriptions.** Test
  descriptions used to be Spanish; they are not any more, and `scripts/check-i18n.mjs` now checks
  comments as well as string literals, so a Spanish comment fails `pnpm check`. The Spanish that
  remains is Spanish on purpose: `messages/es.json`, the Spanish category names and dictionary
  entries in `prisma/seed-data.ts`, the `name (es)` column of `prisma/factory-categories.md`, the
  Spanish shopping words a test uses as fixture data, and Spanish quoted inside a comment as an
  example of what a user typed. Quoted Spanish in a comment passes the check; unquoted Spanish
  prose does not.
- **Every user-visible string goes through both catalogs**, `messages/es.json` and
  `messages/en.json`, and is read with `useTranslations` / `getTranslations`. Never a literal in a
  component. Two things enforce it:
  - `scripts/check-i18n.mjs` fails on any literal in `src/` containing a character Spanish prose
    cannot avoid (`á é í ó ú ü ñ ¿ ¡`). It is a tripwire, not an inventory: `Guardar` and `Cancelar`
    have no accents and slip through, so it catches carelessness rather than proving completeness.
  - `src/i18n/catalogs.test.ts` fails when the two catalogs do not carry exactly the same keys, or
    when a message's placeholders differ between them. A key missing from English is invisible
    otherwise — next-intl renders the raw key on somebody's screen instead of raising anything.
- **Operator-facing text is English and is not translated.** Container log lines, boot-time
  configuration errors and everything `scripts/auth-password.mjs` prints. A log has no
  `Accept-Language` to read, and its reader is whoever wrote the compose file.
- **Shoppa is the sole migration owner of its database**, and new migrations are wrapped in
  `BEGIN`/`COMMIT`. Prisma does not do it, and a statement failing halfway must never leave the
  schema half-changed.
- **The seed is idempotent and additive.** It never resurrects a category the operator deleted and
  never overwrites a name, icon or ordering they changed.
- **Nothing in this repository names a private deployment.** No domains, hosts, addresses, hosting
  providers or people's names outside `LICENSE`. Examples use `example.com` and RFC-1918 addresses.
  Secrets never enter the repository; `.env.example` documents names and shapes, never values.

---

## Sending a pull request

1. **`pnpm check` must be green before you push.** It is lint, typecheck, the i18n check, the test
   suite and a production build, in that order, and CI runs the same command on the same Node and
   pnpm versions. Running it locally is faster than finding out from a red badge.
2. **One change per pull request**, with a description of what problem it solves. If the change
   alters what the product *does* rather than how it does it, it needs a paragraph in `PRODUCT.md`
   in the same pull request.
3. **Commit messages are English and conventional-commit prefixed** (`feat:`, `fix:`, `docs:`,
   `chore:`…). The history from before the repository was opened is in Spanish; everything written
   since is English.
4. **New behaviour comes with a test.** The suite is the reason this project can be installed by
   strangers without a staging environment.

---

## Reporting a bug

Use the bug report template — it asks for these because in a self-hosted application they are what
separates a diagnosable report from a guessing game:

- **The version you are running.** The commit SHA is the honest answer; `git rev-parse --short HEAD`
  in the checkout you built from, or the tag if there is one by the time you read this.
- **How it is deployed.** `docker compose up` from this repository, some other container runtime, or
  `pnpm dev` from source. They fail in different places.
- **`APP_ORIGIN`, and especially its scheme.** It is the authority on cookie security, HSTS and the
  CSRF origin check, so an `https://` value on a plain-HTTP instance makes the browser drop the
  session cookie and login appears to do nothing at all. More login reports come from this than from
  anything else.
- **`AUTH_MODE`**, and whether the account in question signs in with a passkey or a password.
- **The other environment variables that matter to your symptom**, with their *values* where they
  are not secret: `TRUSTED_PROXY` (rate limiting), `TZ` and `PRICE_CHECK_CRON` (the price run),
  `PRICE_FETCH_MODE` (whether prices are read from this host), `WEBAUTHN_RP_ID` and
  `WEBAUTHN_ORIGIN` if you set them. **Never paste `AUTH_SECRET`, `POSTGRES_PASSWORD`,
  `TELEGRAM_BOT_TOKEN`, `N8N_API_KEY`, a voice token or an invitation link.**
- **What the container log says.** `docker compose logs app --tail 200`, from around the moment the
  problem happened. Boot-time configuration errors and the price run both report themselves there
  and nowhere else. Redact anything that looks like a secret before pasting.
- **What you expected, what happened, and the shortest way to reproduce it.**

If the report is about a vulnerability, do not open an issue: see [SECURITY.md](SECURITY.md).

---

Everyone taking part in this project is held to the [Code of Conduct](CODE_OF_CONDUCT.md).
