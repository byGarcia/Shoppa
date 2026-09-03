<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version may have breaking changes. Read the relevant guide in
`node_modules/next/dist/docs/` before changing Next.js code and heed its deprecation notices.

<!-- END:nextjs-agent-rules -->

# Shoppa — repository rules

Shoppa is a self-hosted shared shopping list with price tracking. One Next.js application, one
PostgreSQL database, one container. `README.md` is what it is; `docs/` is how to run it;
`PRODUCT.md` is what it is and is not allowed to become; `CONTRIBUTING.md` is how to work on it and
`SECURITY.md` is what is a vulnerability and what is a documented decision.

## Product

- **Product changes are written down before they are built.** If a change alters what the product
  does — not how it does it — it goes in `PRODUCT.md` first. `PRODUCT.md` is also where the work
  deliberately left for later lives, with the reason it was left.
- **One instance is one household.** No multi-tenancy, no per-user permissions, no notion of
  separate lists for separate groups. Everyone who can sign in sees and edits everything.
- **It is a list and a price watcher.** Not a pantry manager, not a recipe app, not a budget.

## Code

- **Comments and identifiers in `src/lib`, `src/server` and `src/app` are English.** Test
  descriptions are Spanish, following this repository's convention.
- **All interface copy lives in `messages/es.json` and `messages/en.json`**, never in a component.
  `node scripts/check-i18n.mjs` is the tripwire and runs inside `pnpm check`; it allows Spanish only
  where `scripts/check-i18n.mjs` itself says why. Both catalogs must carry the same keys.
- **Operator-facing text is English and is not translated**: container log lines, boot-time
  configuration errors and everything `scripts/auth-password.mjs` prints. It has no locale to read —
  a log has no `Accept-Language` — and its reader is whoever wrote the compose file.
- **`pnpm check` (lint, typecheck, i18n, tests, build) passes before every commit.**
- **Commit messages are Spanish, conventional-commit prefixed.**

## Data

- **Shoppa is the sole migration owner of its database.** The container runs `prisma migrate deploy`
  and then the seed before it serves anything, chained with `&&`, so a failure refuses to start
  rather than serving a half-built instance.
- **New migrations are wrapped in `BEGIN`/`COMMIT`.** Prisma does not do it, and a statement
  failing halfway must never leave the schema half-changed. The cost is that recovery needs
  `prisma migrate resolve --rolled-back`; that is documented in `docs/installation.md`. Two of the
  five migrations that exist predate the rule and do not wrap themselves —
  `20260821063757_initial` and `20260903080000_password_reset_event` — so this is the rule for what
  is written next, not a property of the directory.
- **The seed is idempotent and additive.** It never runs twice, never resurrects a category the
  operator deleted and never overwrites a name, icon or ordering they changed.

## Publication

- **Nothing in this repository names a private deployment.** No domains, hosts, container ids,
  addresses, hosting providers or people's names outside `LICENSE`. Examples in documentation use
  `example.com` and RFC-1918 addresses. There is no automated check that can be trusted for this:
  read the file list before publishing.
- **Secrets never enter the repository.** `.env.example` documents names and shapes, never values.
