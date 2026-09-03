# Shoppa

**The shopping list your household actually shares.** Type `leche entera` from the sofa and it is
already there, under *Dairy*, on the phone of whoever walks into the shop next — one list, a tab per
supermarket, and no arguing about who was supposed to buy the milk. It also keeps an eye on the
price of the things you are waiting to get cheaper, and messages you on Telegram the morning one
drops.

Self-hosted, one container and a PostgreSQL database. No account anywhere, no plan, no tier: your
list lives on your machine and nobody else holds a copy.

![The list, in English](docs/screenshots/list-en-light.png)

## What it feels like to use

- **You type, it files.** A bundled dictionary of 556 product words — Spanish and English — drops
  each thing you add into a category, so the list arrives at the shop already grouped the way the
  aisles are. Nothing to configure; it works on the first item you type.
- **Correct it once and it stays corrected.** Move something to another category and Shoppa
  remembers that word for good. The whole dictionary is a screen in Settings, searchable, with your
  corrections marked apart from the factory ones.
- **One list, every phone.** No rows have owners: one of you adds from home while another ticks
  things off in the shop, and both screens keep up on their own. A tab per shop, a counter on each,
  plus an inbox for the things nobody has decided where to buy yet.
- **Ticking off is the whole interaction.** A tap on the circle, a progress bar that fills, and a
  *Clear ticked* button when you are done. Forget to press it and the ticked rows disappear on
  their own two weeks later.
- **"Hey Siri, add to the shopping list."** Dictate it walking to the car and it is on the list
  before you get in, filed under its category — Siri reads back which one. A second shortcut takes
  things off. Each person's phone uses its own token.
- **Watch a price and then forget about it.** Paste a product URL — or send one from any shop's app
  through the iOS share sheet — and Shoppa reads that page every morning, keeps the history, and
  sends one Telegram message when the price goes below what you set as the reference. One message
  per drop, not one every morning while it stays cheap. If a shop refuses to be read it says so
  instead of inventing a number.
- **Sign in the way your network allows.** A passkey where the browser will make one, a password
  everywhere else — which includes every plain-HTTP address on your own LAN, because WebAuthn needs
  a secure context. Running Shoppa at `http://192.168.1.50:3004` is a first-class way to run it, not
  a degraded one.
- **Two languages under one roof.** Spanish and English, following whatever each browser asks for
  and overridable per browser in Settings, so nobody in the house has to read the other one's
  language.
- **Installable, light and dark.** A PWA that goes on the home screen and opens without browser
  chrome. It is online-only by design: authenticated data is never cached on the device.

| | |
|---|---|
| ![The list in Spanish, dark theme](docs/screenshots/list-es-dark.png) | ![Settings](docs/screenshots/settings-es.png) |
| The same list in Spanish and in dark. The theme is chosen in Settings and remembered in that browser; it does not follow the system setting. | Everything you can change: shops, categories, the dictionary, Siri, Telegram, passkeys, invitations, theme and language. |

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

Three variables are required; everything else has a default that works. The full table, with what
breaks when each one is wrong, is in [docs/installation.md](docs/installation.md). The ones people
actually change:

| Variable | Default | What it is |
|---|---|---|
| `TZ` | UTC | The timezone the daily price run is scheduled in. A container is UTC unless you set this. |
| `PRICE_CHECK_CRON` | `0 8 * * *` | When that run fires, or `off`. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | unset | Where price-drop alerts go. Without them the run still works, silently. |
| `TRUSTED_PROXY` | `none` | `none`, `x-real-ip`, `xff` or `cloudflare`. Which header carries the client IP. |
| `AUTH_MODE` | `auto` | `auto`, `passkey` or `password`. |

Two traps worth reading before you deploy:

- **`TRUSTED_PROXY=none` turns per-IP rate limiting off entirely**, because with no trustworthy
  header there is no address to key a bucket on, and one the caller picks is worse than none. What
  is left is a per-account throttle and a flat per-route ceiling. An instance reachable from the
  internet belongs behind a reverse proxy you control, with `TRUSTED_PROXY` set to match the header
  that proxy writes.
- **A `WEBAUTHN_RP_ID` or `WEBAUTHN_ORIGIN` that is defined but empty is a fatal error**, on
  purpose. Delete the line or give it a value; never leave it blank. It is fatal at the first
  passkey ceremony rather than at boot, so a blank line here is a working instance that fails the
  day somebody adds a key.

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
  traced standalone bundle, because the one thing the tracer would leave out is the `prisma` CLI —
  a devDependency that no application code imports, and `prisma migrate deploy` is the first step
  of every boot. Recorded in [PRODUCT.md](PRODUCT.md).

Three things cross the boundary of your network, all three because you asked for them: Shoppa
fetches the product pages you told it to watch, it sends the price-drop message to the Telegram bot
you configured, and your browser loads each tracked product's thumbnail straight from the shop's own
servers — which is why the content-security policy has to allow images from any `https` origin.

## Documentation

- [docs/usage.md](docs/usage.md) — using it: the list, the categories, the shops, prices, voice.
- [docs/installation.md](docs/installation.md) — compose, every variable, first run, invitations,
  recovery.
- [docs/price-tracking.md](docs/price-tracking.md) — the two fetch modes, the schedule, Telegram.
- [docs/siri-shortcut.md](docs/siri-shortcut.md) — building the Shortcuts and the tokens they use.
- [PRODUCT.md](PRODUCT.md) — what Shoppa owns, and the decisions that shaped it.

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

## Support

Shoppa is free and stays free. If it saved you an argument about who was supposed to buy the milk
and you feel like buying some back, there is
[GitHub Sponsors](https://github.com/sponsors/byGarcia),
[Liberapay](https://liberapay.com/bygarcia) and
[PayPal](https://www.paypal.com/paypalme/adriangmolina). A star or a good bug report is worth just
as much.

## License

MIT. See [LICENSE](LICENSE).
