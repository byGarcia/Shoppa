# Shoppa

Shoppa is a shared shopping list for one household, self-hosted: everybody in the house writes to
the same list from their own phone, and each thing you type drops into its shop tab and its aisle
section on its own. It also watches prices — paste a product URL and Shoppa reads that page every
morning, keeps the history, and tells you on Telegram when the price falls below what it cost the
day you added it.

One container and a PostgreSQL database. No account anywhere: nothing is signed up for and nobody
holds your list but you. Three things do cross the boundary, all three because you asked for them —
Shoppa fetches the product pages you tell it to watch, it sends the price-drop message to the
Telegram bot you configured, and your browser loads each tracked product's thumbnail straight from
the shop's own servers, which is why the content-security policy has to allow images from any
`https` origin.

![The list, in English](docs/screenshots/list-en-light.png)

## What it does

- **One list for the household.** A tab per shop plus an inbox for things not assigned to one yet.
  Rows have no owner: whoever picks it up ticks it.
- **It files things for you.** A bundled dictionary of 556 product words, Spanish and English, puts
  each item under a category. Correct it once and the correction wins from then on.
- **Price tracking.** Paste a URL, Shoppa reads the current price and keeps it as the reference.
  Every morning it checks again, records the history and sends a Telegram message on a drop. If a
  shop refuses to be read, it says so instead of inventing a number, and you can type the reference
  by hand.
- **Voice input.** iOS Shortcuts add and remove items by dictation, and the share sheet can send a
  product page straight to price tracking. Each person uses their own bearer token.
- **Passkeys or passwords.** Passkeys where the browser allows them, passwords everywhere else —
  which includes every plain-HTTP LAN address, because WebAuthn needs a secure context.
- **Installable.** A PWA, online-only, with a light and a dark theme. The theme is chosen in
  settings and remembered in that browser; it does not follow the system setting.
- **Two languages.** Spanish and English. The language follows what the browser asks for and can be
  overridden in settings, per browser rather than per account.

| | |
|---|---|
| ![The list in Spanish, dark theme](docs/screenshots/list-es-dark.png) | ![Settings](docs/screenshots/settings-es.png) |
| The same list in Spanish and in the dark theme, chosen in settings. | Settings: shops, categories, the dictionary, Siri, Telegram, passkeys, invitations, theme and language. |

![The same list at desktop width](docs/screenshots/list-desktop-es.png)

## Get started

You need Docker with the Compose plugin. There is no published image yet; the compose file builds
from source.

```bash
git clone <repository-url> shoppa
cd shoppa
cp .env.example .env
```

Edit `.env` and set three things:

```bash
# How this instance is reached from a browser. Scheme included, no trailing path.
APP_ORIGIN=http://192.168.1.50:3004
# openssl rand -base64 32
AUTH_SECRET=<a long random string>
# The database password. Choose it before the first start: it is baked into the
# volume when PostgreSQL initialises.
POSTGRES_PASSWORD=<another random string>
```

Then:

```bash
docker compose up -d
```

The container migrates the database, seeds the twelve factory categories and the dictionary, and
only then starts serving.

Now open `APP_ORIGIN` in a browser. It sends you to `/setup`, which asks for an install token — and
that first request is also what makes the container print it. So ask for the page first, then read
the log:

```bash
docker compose logs app | grep setup
```

Paste the token, pick an email and a password of at least 12 characters, and the instance is yours.
The token is printed on the first request of every boot for as long as no account exists, so an
interrupted install is one you can resume. Registration closes the moment that first account
exists — everybody else arrives through an invitation link you create in Settings.

Then create your first shop in Settings, and start typing.

## Configuration

Full table in [docs/installation.md](docs/installation.md). The short version:

| Variable | Default | What it is |
|---|---|---|
| `APP_ORIGIN` | — **required** | The origin browsers use. Its scheme decides cookie security and HSTS. |
| `AUTH_SECRET` | — **required** | Signs sessions, and seeds the install token. |
| `POSTGRES_PASSWORD` | — **required** | The bundled database's password; `DATABASE_URL` is built from it. |
| `AUTH_MODE` | `auto` | `auto`, `passkey` or `password`. An unknown value is refused rather than defaulted — but on the first request, not at boot: the container comes up and answers 500. |
| `TRUSTED_PROXY` | `none` | `none`, `x-real-ip`, `xff` or `cloudflare`. Which header carries the client IP. |
| `PRICE_FETCH_MODE` | `local` | `local` fetches product pages itself; `assisted` waits for a fetcher in your network. |
| `PRICE_CHECK_CRON` | `0 8 * * *` | When the daily price run fires, or `off`. |
| `TZ` | UTC | The timezone `PRICE_CHECK_CRON` is read in. A container is UTC unless you set this. |
| `SETUP_TOKEN` | derived from `AUTH_SECRET` | Set it yourself if you would rather not read the log. |
| `WEBAUTHN_RP_ID` | host of `APP_ORIGIN` | Only set it if your passkeys were registered against a parent domain. |
| `WEBAUTHN_ORIGIN` | `APP_ORIGIN` | Same. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | unset | Where price-drop alerts go. Without them the run still works, silently. |
| `N8N_API_KEY` | unset | Bearer key for the machine-to-machine price endpoints. Required in `assisted` mode. The name is a leftover; see [docs/price-tracking.md](docs/price-tracking.md). |

Two traps worth reading before you deploy:

- **A `WEBAUTHN_RP_ID` or `WEBAUTHN_ORIGIN` that is defined but empty is a fatal error**, on
  purpose. Delete the line or give it a value; never leave it blank. It is fatal at the first
  passkey ceremony rather than at boot — nothing validates those two variables until something
  needs them — so a blank line here is a working instance that fails the day somebody adds a key.
- **`TRUSTED_PROXY=none` turns the per-IP rate limiting off entirely**, because with no
  trustworthy header there is no address to key a bucket on and one the caller picks is worse than
  none. What is left is a per-account throttle and a flat per-route ceiling. An instance reachable
  from the internet belongs behind a reverse proxy you control, with `TRUSTED_PROXY` set to match
  the header that proxy writes.

## What it is not

- **Not multi-tenant.** One instance is one household. There is no notion of separate lists for
  separate groups, and there is no plan for one.
- **No per-user permissions.** Everyone who can sign in sees and edits everything, and can invite
  the next person. The only per-user rows are the voice tokens.
- **Not a stock or pantry manager, not a recipe app, not a budget.** It is a list and a price
  watcher.
- **Not built to scale out.** One container. The assisted price mode keeps its work queue in
  memory, so a second replica would break it.

## Known limitations

- **English plurals are matched imperfectly.** The text normaliser applies a Spanish
  pluralisation rule to every language, so "tomato sauces" normalises to something the English
  dictionary does not answer, and lands in the wrong category. Correct it once in the dictionary
  and the correction sticks. Fixing it properly means changing a normaliser whose output is stored
  in the database, so it is a migration, not a patch.
- **Registering a passkey deletes that account's password**, and this version has no screen to set
  one again. The way back is a rescue script run inside the container — see
  [docs/installation.md](docs/installation.md).
- **Some shops cannot be read from a datacenter address.** That is what `assisted` mode exists
  for; see [docs/price-tracking.md](docs/price-tracking.md).
- **The image is larger than it needs to be.** It ships the whole `node_modules` rather than a
  traced standalone bundle. The one thing the tracer would leave out and the container needs is the
  `prisma` CLI: it is a devDependency, no application code imports it, and `prisma migrate deploy`
  is the first step of every boot. The seed and the password rescue are not part of the problem —
  both talk to PostgreSQL through `pg` on purpose, precisely so they do not need the generated
  client. Recorded in [PRODUCT.md](PRODUCT.md).

## Development

You need **Node 24, 25 or 26** and **pnpm 11.13.0**. Both are pinned in `package.json`; the easiest
way to get the right pnpm is `corepack enable`, which is what the Dockerfile does. Older Node is not
a preference: `pnpm install` fails with `EBADENGINE`, and `pnpm db:seed` runs `prisma/seed.ts`
through `node` directly, which needs the TypeScript stripping Node only does by itself from 24.

Development reads **`.env.local`**, not `.env`. That is where `prisma.config.ts`, the seed and the
test runner all look, and none of them read `.env` — which is Compose's file, for the deployment
above. Create it first or every Prisma command stops at `Cannot resolve environment variable:
DATABASE_URL`.

```bash
pnpm install

cat > .env.local <<'EOF'
DATABASE_URL=postgresql://shopping:shopping_dev@127.0.0.1:5437/shopping
APP_ORIGIN=http://localhost:3004
AUTH_SECRET=dev-secret-long-enough-to-sign-things
EOF

pnpm db:up        # PostgreSQL from compose.dev.yaml, on 127.0.0.1:5437
pnpm db:generate  # the Prisma client, into the gitignored src/generated/
pnpm db:deploy
pnpm db:seed

pnpm dev          # http://localhost:3004
pnpm check        # lint, typecheck, i18n, tests, build
```

`pnpm db:generate` is not optional on a fresh clone: `src/generated/` is gitignored, so without it
`typecheck`, `test`, `build` and `dev` all fail on a missing module.

`compose.dev.yaml` starts the database only. `compose.yaml` is the one that installs Shoppa.

The test suite runs against that same database and mutates it on purpose. `pnpm db:seed` is
idempotent, so re-running it after a suite is harmless.

## Documentation

- [docs/installation.md](docs/installation.md) — compose, every variable, first run, invitations,
  recovery.
- [docs/price-tracking.md](docs/price-tracking.md) — the two fetch modes, the schedule, Telegram.
- [docs/siri-shortcut.md](docs/siri-shortcut.md) — building the Shortcuts and the tokens they use.

## License

MIT. See [LICENSE](LICENSE).
