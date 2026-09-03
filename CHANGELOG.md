# Changelog

Notable changes to Shoppa, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are no tags and no published container image yet, so "the version you are running" is a
commit SHA rather than a number. When that changes, the versions here will follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Changed

- **The screens live at English paths.** `/ajustes` is now `/settings` — with `/settings/stores`,
  `/settings/categories`, `/settings/dictionary`, `/settings/shortcut` and `/settings/telegram` —
  and `/precios` is now `/prices`. The documentation always called them Settings and Prices; the
  URLs did not. Nothing links to the old paths any more, and there is no redirect: a bookmark to
  one of them gets a 404. The installed PWA opens at `/`, so it is unaffected, and none of the
  `/api/` routes moved — the Siri shortcuts and any assisted price fetcher keep working.
- **The browser preferences are stored under the app's own name.** `compra-theme`, `compra-tab`
  and `compra-add-dest` become `shoppa-*`. Each is migrated on first read, so nobody's theme or
  last-used tab resets.
- **The offline page speaks both languages.** It used to be Spanish for everybody. A service
  worker cannot read the app's locale cookie, so it follows the browser's own language and falls
  back to English.
- **The repository is in English.** Comments, identifiers and test descriptions, which were partly
  Spanish from when this was one household's private application. `node scripts/check-i18n.mjs`
  now checks comments as well as string literals, so Spanish prose in a comment fails `pnpm check`.
  The Spanish that remains is Spanish on purpose: the `es` catalog, the Spanish category names and
  dictionary entries in the seed, and the shopping words the tests use as fixtures.

## 0.1.0 — 2026-09-03

**First public release.** Not a summary of a history — there is none to summarise. This is the
point at which the code stopped being one household's private application and became something a
stranger can install. What that release contains:

### The application

- A **shared shopping list** for one household per instance. No rows have owners: everybody who can
  sign in sees and edits everything. A tab per shop, a counter on each, an inbox for the items
  nobody has decided where to buy, and a *Clear ticked* sweep, with ticked rows expiring on their
  own after two weeks.
- **Automatic categorisation** from a bundled dictionary of 556 Spanish and English product words,
  seeded on first boot alongside twelve factory categories. Correcting a row's category teaches the
  word for everybody, and the whole dictionary is an editable screen in Settings.
- **Price tracking.** A watched product URL is read once a day on a schedule you set, the history is
  kept, and one Telegram message goes out when the price crosses the reference — one per drop, not
  one a morning. Two fetch modes: `local` reads the page from the instance itself; `assisted`
  expects a fetcher inside your own network, for shops that refuse a datacenter address.
- **Voice input** through two iOS Shortcuts, one to add and one to remove, each phone carrying its
  own token.
- **Passkeys or passwords.** WebAuthn where the browser will make a credential, scrypt-hashed
  passwords everywhere else — which includes every plain-HTTP LAN address, since WebAuthn needs a
  secure context. `AUTH_MODE` can pin either.
- **Spanish and English** interface, resolved per browser and overridable in Settings; light and
  dark; installable as a PWA, and online-only by design so that authenticated data is never cached
  on the device.

### Getting in, and keeping others out

- First boot prints an **install token** while the instance has no account; claiming it creates the
  only self-service account. Registration closes at that point, and everybody else arrives through a
  **single-use invitation link** that is hashed at rest and expires after 72 hours.
- **Rate limiting** with a per-account login throttle that no header can forge, flat per-route
  ceilings, and per-IP buckets that only switch on when `TRUSTED_PROXY` names a header worth
  believing.
- A **password rescue script** that runs inside the container, for the account that traded its
  password for a passkey and lost the device.

### Running it

- **One container plus PostgreSQL**, described by `compose.yaml`. The container applies its
  migrations and runs its idempotent seed before it serves a single request, chained so that a
  failure refuses to start rather than serving a half-built instance.
- **Three required variables** — `APP_ORIGIN`, `AUTH_SECRET`, `POSTGRES_PASSWORD` — and defaults
  that work for everything else. `.env.example` documents every one of them.
- Documentation for installing, using, price tracking and the Siri shortcuts, in `docs/`.

### Known at release

Written down rather than discovered: English plurals are matched imperfectly by a normaliser that
applies a Spanish rule to every language; registering a passkey deletes that account's password and
only the rescue script can set one again; some shops cannot be read from a datacenter address; and
the image ships the whole `node_modules` because the standalone tracer would leave out the `prisma`
CLI that every boot depends on. All four are in the README, with the reasoning in `PRODUCT.md`.
