# Product

## Purpose

Shoppa is a shared shopping list for one household, self-hosted. Everybody in the house writes to
the same list from their own phone, each item files itself into a shop tab and an aisle section, and
tracked product pages are re-read every morning so a price drop reaches Telegram.

It is deliberately small. One container, one PostgreSQL database, no account anywhere. The only
things that cross the boundary are the ones the household asks for: the product pages it tracks, the
Telegram bot it sends drops to, and the shop-hosted thumbnails the browser loads on the price
screen.

## Product boundary

Shoppa owns:

- the shared household grocery list, supermarket tabs and the unassigned inbox;
- grocery categories and the seeded and learned categorization dictionary;
- PWA installation, theme and online-only service-worker behaviour;
- passkey and password sign-in, first-run claim and invitations;
- Siri Shortcut tokens and the public add / remove / track ingestion endpoints;
- tracked products, price history, the price-drop decision and the daily schedule;
- the machine-to-machine endpoints an external fetcher uses in `assisted` mode.

Shoppa does not own:

- anything about the network it is installed on;
- the Telegram bot itself — Shoppa decides what should be notified and, in `assisted` mode, may hand
  the message to the fetcher to deliver so the bot token never has to reach the server;
- the external fetcher of `PRICE_FETCH_MODE=assisted`. Shoppa specifies the three endpoints it must
  speak (`docs/price-tracking.md`) and ships no implementation.

## What it is not

- **Not multi-tenant.** One instance is one household, and there is no plan for anything else.
- **No per-user permissions.** Everyone who can sign in sees and edits everything, and can invite
  the next person. The only per-user rows are the voice tokens.
- **Not a stock or pantry manager, not a recipe app, not a budget.**
- **Not built to scale out.** One container: the assisted-mode fetch queue is in memory, so a second
  replica would complete jobs the other instance is waiting on.

## Decisions that shape the product

- **Two ways to sign in.** A passkey where the browser allows one, a password everywhere else —
  which includes every plain-HTTP LAN address, because WebAuthn needs a secure context. `AUTH_MODE`
  (`auto` by default, `passkey`, `password`) sets the instance policy, and an unrecognised value is
  refused rather than defaulted — on the first request, since that is where the environment is
  validated; see `docs/installation.md`.
- **Where both are offered, the passkey is the offer.** With `AUTH_MODE=auto` the sign-in screen
  leads with the passkey and puts the password behind a control that reveals it. Every account that
  came from an older installation has a passkey and no password, and used to be shown a field that
  could never work for it, given the same weight as the button that could. It is reordered rather
  than adapted: the screen must not know which of the two an address has before the address is
  submitted, or the screen answers "does this account exist here" to anybody who types.
- **Registering a passkey deletes that account's password.** Deletes, not disables: a dormant hash
  is a secret one `UPDATE` revives. The way back is `scripts/auth-password.mjs`, run inside the
  container, which is the level of proof that deserves.
- **A passkey can be retired, and never the last way in.** Settings lists the account's keys and
  removes one on the same proof registering demands — the current password, or an assertion from a
  key it already holds — because a borrowed session must not be able to strip its owner's key any
  more than it may attach its own. What no proof buys is leaving an account with nothing that opens
  it: the last credential of an account with no usable password is refused by the server, not merely
  hidden by the interface, and two deletions racing for the last two keys are ordered by a lock on
  the account's row so that one of them loses.
- **First run is a claim, not a registration.** An instance with no accounts can be claimed once,
  with a token printed to the container log on the first request of every boot until somebody does.
  After that, registration is closed and everybody else arrives by single-use invitation.
- **It ships with content.** Twelve factory categories and a bilingual categorization dictionary. No
  shops: which supermarkets exist is the household's to say.
- **Two languages.** Spanish and English, chosen by the browser and overridable in settings. Factory
  category names follow the interface language until they are renamed; renaming wins from then on.
- **Price tracking runs by itself.** The application keeps its own clock (`PRICE_CHECK_CRON`) and
  fetches product pages itself. `PRICE_FETCH_MODE=assisted` is the optional mode for shops that
  refuse a datacenter address, and it moves only the download.
- **A price is never invented.** A shop that cannot be read produces a typed failure with its
  reason, and the reference can be typed by hand.

## Deliberately left for later

- **A smaller image.** `next.config.ts` asks for `output: "standalone"` and the Dockerfile ignores
  it, copying the whole `node_modules` instead. Fixing it is worth real megabytes on an ARM board.
  The blocker is exactly one package: `prisma`, the CLI, is a devDependency that no application code
  imports, so the standalone tracer will never include it and `migrate deploy` — the first step of
  every boot — would fail. The seed and the password rescue are NOT blockers: both reach PostgreSQL
  through `pg`, a production dependency, rather than through the generated client, and they are
  copied into the image file by file already. It gets its own change and its own boot test, not a
  line in a release whose job is that a stranger can install this at all.
- **Setting a password again, from the interface.** An account that traded its password for a
  passkey has no screen that puts one back; the way is `scripts/auth-password.mjs` inside the
  container. Deleting a passkey used to be on this list with it and no longer is — see above — which
  is what makes the last-credential guard load-bearing: without a way to set a password, the last
  key really is the whole of how somebody gets in.
- **`N8N_API_KEY` is a bad name.** It is the bearer key of the machine-to-machine price endpoints
  and has nothing to do with any workflow runner. Renaming it would break the environment of every
  existing deployment for a cosmetic gain, so it stays until there is a reason to break it anyway.
- **English plurals are matched imperfectly.** The text normaliser applies a Spanish pluralisation
  rule to every language, so some English plurals miss the dictionary and land uncategorized. The
  normaliser's output is stored in the database, so fixing it is a migration rather than a patch.
