# Installing Shoppa

Shoppa is one Node container plus one PostgreSQL database. Everything it needs at runtime comes
from environment variables; nothing is written to disk except the database volume.

- [Requirements](#requirements)
- [The compose file](#the-compose-file)
- [Environment variables](#environment-variables)
- [First run](#first-run)
- [Adding the rest of the household](#adding-the-rest-of-the-household)
- [Passkeys and secure contexts](#passkeys-and-secure-contexts)
- [Behind a reverse proxy](#behind-a-reverse-proxy)
- [Recovery](#recovery)
- [Upgrading and backing up](#upgrading-and-backing-up)

## Requirements

- Docker with the Compose plugin.
- PostgreSQL 18. The compose file brings one up; point `DATABASE_URL` at your own if you prefer.
- No native build tools. Password hashing uses `scrypt` from Node's standard library rather than
  argon2 or bcrypt, precisely so the image builds on a small ARM board.

There is no published image yet. The compose file builds from the repository.

## The compose file

`compose.yaml` in the repository root brings up both services. Trimmed to its shape:

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "3004:3004"
    environment:
      APP_ORIGIN: ${APP_ORIGIN}
      AUTH_SECRET: ${AUTH_SECRET}
      DATABASE_URL: postgresql://shoppa:${POSTGRES_PASSWORD}@db:5432/shoppa
      TZ: ${TZ:-UTC}
      # …every optional variable, each as ${NAME:-}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: shoppa
      POSTGRES_USER: shoppa
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - shoppa-db:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shoppa -d shoppa"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  shoppa-db:
```

What each part is doing:

- **`ports: "3004:3004"`.** The application listens on 3004 inside the container. Change only the
  left-hand side; `APP_ORIGIN` has to name the port you publish.
- **`depends_on: condition: service_healthy`.** The container runs its migrations before it serves
  anything, so it must not start before Postgres accepts connections.
- **The database volume is `/var/lib/postgresql`**, not `/var/lib/postgresql/data`: that is where
  the `postgres:18` image keeps its cluster.
- **The container's own start-up is three steps chained with `&&`**: apply migrations, run the
  seed, then serve. If either of the first two fails, the application does not start at all rather
  than serving a half-built database.
- **There is a healthcheck inside the image** too. It polls `/api/health` and reports the
  container unhealthy when the application stops answering.
- **Every optional variable is passed as `${NAME:-}`**, so Compose does not warn about the ones you
  did not set and the application applies its own default — with two exceptions. `WEBAUTHN_RP_ID`
  and `WEBAUTHN_ORIGIN` are not in the file at all, because for those two an empty value is a fatal
  error rather than "unset" (see below), and `${VAR:-}` produces exactly that. Add the line
  yourself, with a value, only if you need to override the default.

Compose reads `.env` from the directory it runs in, which is where `APP_ORIGIN`, `AUTH_SECRET`,
`POSTGRES_PASSWORD` and anything else you set come from. Copy `.env.example` and edit it.

`compose.dev.yaml` is a different file for a different job: it starts the database alone, on a
loopback port, for `pnpm dev` and the test suite. It is not how you install Shoppa.

## Environment variables

### Required

| Variable | What breaks if it is wrong |
|---|---|
| `APP_ORIGIN` | Everything. See below. |
| `AUTH_SECRET` | Sessions cannot be signed and the install token cannot be derived. |
| `POSTGRES_PASSWORD` | The bundled database. It is baked into the volume on first initialisation, so changing it later does not change the database's password. |
| `DATABASE_URL` | Only if you bring your own database: `compose.yaml` builds this value from `POSTGRES_PASSWORD`. |

**`APP_ORIGIN`** is the single authority on how this instance is reached: scheme, host and port,
with no path — `http://192.168.1.50:3004` or `https://shopping.example.com`. It is validated on
the first request, and a missing value, a value that is not a URL, a scheme other than `http` or
`https`, or a value carrying a path or a query all stop the instance with the name of the variable
in the error.

Three things are derived from it, and they are the reason it exists. The first two follow the
**scheme**; the third uses the whole origin, and does so on both:

| | `https` | `http` |
|---|---|---|
| Session cookie | `__Secure-authjs.session-token`, `secure` | `authjs.session-token`, not secure |
| `Strict-Transport-Security` | sent on every response the application handles | not sent |
| CSRF origin check | compares against `APP_ORIGIN` | compares against `APP_ORIGIN` |

"Every response the application handles" is not quite every response: static assets are excluded by
the proxy's matcher — `/_next/static`, `/_next/image`, `/icons`, `/sw.js`, `/manifest.json` and the
two favicons — and carry no headers from it. Every navigation and every API call does, including the
401, the 403, the 429 and the redirect to `/login`, which is the first response most visitors ever
see and exactly when the pin should be established.

Get the scheme wrong in the `https` direction and the browser refuses to store the session cookie:
sign-in appears to succeed and the next page bounces you back to the login screen. Get it wrong in
the `http` direction on a public instance and you lose HSTS.

**`AUTH_SECRET`** is a long random string — `openssl rand -base64 32`. It signs sessions and the
WebAuthn challenge cookie, and it is also the seed of the install token. It is **not** validated
with the rest: an instance without it starts, serves the login screen, and then fails per request
in whatever needed it.

There is a warning on the log naming the variable, but only while the instance is unclaimed —
printing the install token is the first thing that asks for the secret, so that is where the failure
surfaces. On an instance that already has an account nothing asks until somebody tries to sign in,
and then it is a 500 with no warning ahead of it. Set it before you start.

Changing `AUTH_SECRET` invalidates every existing session and changes the derived install token.

**`DATABASE_URL`** is a standard PostgreSQL URL. Shoppa owns its schema: it applies its own
migrations at boot, so give it a database of its own.

### Everything else

| Variable | Default | What it does, and what breaks if it is wrong |
|---|---|---|
| `AUTH_MODE` | `auto` | `auto` accepts both a passkey and a password; `passkey` refuses passwords instance-wide; `password` refuses passkeys instance-wide, including registering one. **An unrecognised value is refused rather than defaulted** — a typo must not silently widen what is accepted. It is refused on the first request, not at boot: see the note below the table. Switching a live instance to `passkey` locks out anybody who only has a password. |
| `TRUSTED_PROXY` | `none` | Which header is believed to carry the client IP: `none`, `x-real-ip`, `xff` (`X-Forwarded-For`) or `cloudflare` (`CF-Connecting-IP`). Only the named header is read. An unrecognised value is refused rather than defaulted, on the first request. See [Behind a reverse proxy](#behind-a-reverse-proxy). |
| `PRICE_FETCH_MODE` | `local` | `local` downloads product pages from this host. `assisted` expects a fetcher inside your own network and enables the three machine-to-machine endpoints. See [price tracking](price-tracking.md). |
| `PRICE_CHECK_CRON` | `0 8 * * *` | When the built-in daily price run fires. `off` disables it. An expression the parser cannot read is reported by name in the log and **no run is scheduled at all** — the instance keeps serving the shopping list, which is the right trade, but check the log after changing this. |
| `TZ` | UTC | The timezone `PRICE_CHECK_CRON` is evaluated in. **A container is UTC unless you say otherwise**, so `0 8 * * *` means 09:00 or 10:00 local in most of Europe. Set it, for example `TZ=Europe/Madrid`. An unknown zone name is refused the same way a bad expression is. |
| `SETUP_TOKEN` | derived from `AUTH_SECRET` | The token that claims an unclaimed instance. Leave it unset and the derived value is printed to the log on the first request of every boot, for as long as no account exists. Set it if you would rather not read the log. |
| `WEBAUTHN_RP_ID` | hostname of `APP_ORIGIN` | The WebAuthn relying-party id. Only set it if your passkeys were registered against a different (usually parent-domain) id: **changing this value invalidates every passkey already registered**. |
| `WEBAUTHN_ORIGIN` | `APP_ORIGIN` | The origin the browser must present during a WebAuthn ceremony. Same rule. |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token for price-drop alerts; `TELEGRAM_TOKEN` is accepted as an alias, because people reuse a bot whose token is already stored somewhere under that name. Missing configuration is a no-op plus one warning in the log, never a failure: a missing token must not take the daily price run down with it. |
| `TELEGRAM_CHAT_ID` | unset | The chat those alerts go to. Both are needed or neither does anything. |
| `N8N_API_KEY` | unset | Bearer key for the machine-to-machine price endpoints (`/api/prices/check`, and in `assisted` mode `queue`, `ingest` and `fetch-jobs`). Those routes answer 500 while it is unset, and 401 to a wrong key. |

**"Refused" does not mean the container refuses to start.** `APP_ORIGIN`, `AUTH_MODE`,
`TRUSTED_PROXY` and `PRICE_FETCH_MODE` are validated together, on the **first request**, and
deliberately so: the same module is imported by `next build` and by the test runner, neither of
which has an environment. What that means in practice is worth knowing before you go looking for a
crash that is not there. With `AUTH_MODE=passkeys`, `docker compose up -d` succeeds, `docker compose
ps` reports the container `Up`, and **every request answers 500**. The reason is on the log, with
the name of the variable and the values it accepts:

```bash
docker compose logs app | tail -20
```

So: an instance that is up but answers 500 to everything is a configuration error, and the log says
which one.

**Both `WEBAUTHN_*` variables treat "defined but empty" as a fatal error, deliberately.** Elsewhere
in `.env` an empty value means "unset", and silently deriving here would turn a stray blank line
into a permanently unusable passkey. Delete the line or give it a value; never leave it blank.

## First run

1. `docker compose up -d`.
2. Open `APP_ORIGIN` in a browser. `/login` redirects to `/setup` for as long as the instance has no
   account. **This step comes before reading the log, and that is not a style choice**: the
   installation token is printed on the first request the container serves, not at boot, so a
   `docker compose logs app | grep setup` issued straight after `up -d` finds nothing and gives you
   no way to tell whether to wait, restart or start debugging.
3. `docker compose logs app | grep setup`. Now the line is there. The full log also shows the
   migrations and the seed, in that order, both before the port answered.
4. Paste the token, give an email and a password of at least 12 characters — or register a passkey
   if the browser will make one here.
5. That is it. Registration is closed from the moment the first account exists.

(If nobody opens the page, the image's own healthcheck will eventually make that first request for
you and the token will appear on its own, within about half a minute of the container starting. It
is not something to wait on: ask for the page.)

Facts worth knowing about that ceremony:

- **The token is checked at both ends.** A passkey registration is two round trips, and the token
  travels with both; the second one is verified inside the same database transaction that creates
  the account.
- **The claim is atomic.** Two people racing to claim a fresh instance produce exactly one account:
  the claim is a conditional `UPDATE` on a single row, and the loser's transaction rolls back
  whole.
- **A restart before you finish prints the same token again** — it is derived from `AUTH_SECRET`,
  not drawn fresh — so an interrupted install is just an install you can resume.
- **Registering with a passkey never writes a password.** The rule "a passkey replaces the
  password" applies from the account's first moment rather than being applied afterwards.
- **The seed runs before the port answers.** A new install has twelve categories with their colours
  and a 556-entry categorization dictionary (Spanish and English), and no shops: which supermarkets
  exist is yours to say. Create the first one in Settings.
- **`POST /api/setup` expects a browser.** State-changing requests are checked for a same-origin
  `Sec-Fetch-Site` or a matching `Origin`, so a `curl` that sends neither is refused with a bare
  `403 Forbidden` — which reads exactly like a rejected token and is not one. If you are scripting
  the claim, send `Origin: <your APP_ORIGIN>`.

## Adding the rest of the household

Registration is closed once an account exists, so everyone after the first arrives by invitation.

In Settings, "Invite someone" creates a single-use link that **expires in 72 hours**. The link is
shown once — only its SHA-256 hash is stored — so copy it and send it. Whoever opens it creates
their account, with a passkey or a password, subject to `AUTH_MODE`.

The screen also lists unused invitations and lets you revoke one. Redeeming is atomic in the same
way the first claim is: a link cannot be used twice, and an expired link is not silently marked
used.

An invited person has the same powers as the person who invited them, including inviting others.
Shoppa has no per-user permissions and this release does not add any.

## Passkeys and secure contexts

Browsers only create and use passkeys in a **secure context**: HTTPS, or `localhost`. On a plain
`http://192.168.x.x` address they are impossible — not disabled by Shoppa, impossible in the
browser. That is why password login exists.

So:

- Deploying on a LAN address over plain HTTP is fully supported. Use a password. The setup screen
  detects it and says so.
- Put the instance behind HTTPS later and each person can add a passkey from Settings.
- `AUTH_MODE=passkey` on a plain-HTTP instance is a configuration with no way in. The setup screen
  says that too, rather than showing a form that cannot work.

**Adding a passkey deletes that account's password.** Not disables — deletes; a disabled hash is a
dormant secret that one `UPDATE` revives. The interface asks you to confirm your current password
(or an existing passkey) first, and spells out what you are losing. See [Recovery](#recovery) for
the way back.

## Behind a reverse proxy

Shoppa rate-limits per IP, and it can only do that if it can tell what the client's IP is. Behind
a proxy the socket address is the proxy's, so the address has to come from a header — and a header
any caller can set is not evidence. `TRUSTED_PROXY` names the one header to believe, and nothing
else is read.

| Setting | Use it when |
|---|---|
| `none` (default) | Nothing in front. |
| `x-real-ip` | Your proxy sets `X-Real-IP` (nginx and Traefik commonly do). |
| `xff` | Your proxy sets `X-Forwarded-For`. |
| `cloudflare` | Cloudflare is in front, setting `CF-Connecting-IP`. |

Set it to match the proxy you actually run, and make sure that proxy **overwrites** the header
rather than appending to whatever the client sent.

**With `none`, per-IP limiting is off.** There is no trustworthy address, and a bucket keyed on a
value the caller picks is a fresh bucket per attempt — worse than none. What defends the instance
in that configuration:

- **A per-account throttle.** Five consecutive failures for one account and further attempts are
  refused for fifteen minutes. A correct password clears the counter — but only up to the fifth
  failure. **Once the account is throttled, the right password is refused too**, for the rest of the
  window: the check runs before the lookup, so nothing gets as far as comparing what you typed. The
  refusal costs the same as a wrong password, so it leaks nothing, and it is a delay rather than a
  permanent lock, so nobody can lock a household out for good by guessing at it. No header can forge
  it. See [Recovery](#recovery) for the two ways out.
- **A flat ceiling of 30 requests a minute on each sensitive route** — the login, the setup and
  invitation endpoints, the WebAuthn ceremonies and the voice ingest — plus an instance-wide
  ceiling of 60 failed logins a minute.

With a trusted header configured, the per-IP buckets apply as well: 100 requests a minute per
address in general, 5 a minute for state-changing requests on the sensitive routes, and 12 for the
passkey registration ceremony, which costs three requests per honest attempt.

**An instance exposed to the internet belongs behind a proxy you control, with `TRUSTED_PROXY` set
to match it.**

## Recovery

### Somebody registered a passkey and lost the device

There is no screen for this. Reset the password from inside the container:

```bash
docker compose exec app node scripts/auth-password.mjs someone@example.com
```

It asks for the new password on the terminal with echo off — never pass it as an argument, where
it lands in your shell history and in `ps` — writes the hash, bumps that user's token version,
which kills every session that account had open, and records a `PASSWORD_RESET` row in
`security_logs`. Shell access on the host is the level of proof this deserves.

It needs a real terminal: `docker compose exec` allocates one, plain `docker exec` needs `-it`.

The same script sets a password on an account that never had one, and it leaves any passkeys on
that account alone.

**The rescue does not clear the login throttle, and that matters here more than anywhere.** The
situation this script exists for usually arrives after somebody has tried and failed to sign in a
few times, and five consecutive failures arm a fifteen-minute refusal on that account. The counter
lives in the memory of the running Next server; this script is a separate process that talks
straight to PostgreSQL, so it cannot reach it. The new password will be refused exactly like the old
one, and at exactly the same cost, which is what makes it hard to tell apart from a rescue that did
not work. The script says so after it finishes. Two ways out:

- **Wait for the window.** Fifteen minutes from the **first** failure, not the fifth — so if the
  five attempts were spread over ten minutes, there are five left, not fifteen.
- **Restart the container.** `docker compose restart app` clears every counter, because they are
  memory and nothing else. It costs the seconds of a restart and closes nobody's session.

### The install token is not in the log any more

Restart the container and then ask it for a page: the token is printed on the first request of every
boot, for as long as the instance is unclaimed. Or set `SETUP_TOKEN` yourself and restart. Once an
account exists the token stops being printed and stops working, which is the point.

### `AUTH_MODE` locked everybody out

Switching a running instance to `passkey` refuses passwords instance-wide, and the rescue script
cannot help because the mode refuses passwords outright — the script says so when it notices. Set
`AUTH_MODE=auto` and restart.

Switching to `password` refuses passkey assertions, and also refuses passkey **registration** —
otherwise the instance would hand out a key that does not open the door and delete the password
that does.

### Passkeys stopped working after a domain change

`WEBAUTHN_RP_ID` is baked into every credential when it is registered. If it changes, existing
passkeys are no longer offered. Set `WEBAUTHN_RP_ID` back to the previous value explicitly and
restart. If the previous value is genuinely gone, the rescue script above is the way in.

### A migration failed

Prisma does not run a migration inside a transaction, so each file has to wrap itself, and **not
all of them do**: three of the five in this release open with `BEGIN` and close with `COMMIT`, and
two do not — including `20260821063757_initial`, the one that creates the whole schema. A statement
failing halfway through one of those two leaves the schema half-changed, and putting it right means
looking at what ran. (In practice `20260821063757_initial` only ever runs against an empty database,
where the answer is to drop it and start again.)

**Either way the container does not recover on its own.** From then on
`prisma migrate deploy` aborts with **P3009** — "migrate found failed migrations" — and applies
nothing, so the container refuses to start on every restart until somebody resolves it:

```bash
docker compose run --rm app node node_modules/prisma/build/index.js \
  migrate resolve --rolled-back <migration_name>
```

Then start it again, having fixed whatever the migration tripped over.

Be aware that **on a wrapped migration the transaction swallows the real error**. Once a statement
fails, Postgres reports "current transaction is aborted" for everything after it and the migration's
log column comes back empty, so the container log will not tell you which statement broke. Reproduce
it against a copy of the database, outside a transaction, to see the actual message.

### Restoring from a backup

Nothing lives outside PostgreSQL, so a database restore is a full restore. The only state Shoppa
keeps in memory is the assisted-mode fetch queue, whose entries live for seconds.

## Upgrading and backing up

Upgrading is `git pull` then `docker compose up -d --build`. Migrations run at boot, before the
port answers. The seed is guarded: it never runs twice, never resurrects a category you deleted
and never overwrites a name, icon or ordering you changed.

Backups are an ordinary PostgreSQL dump:

```bash
docker compose exec db pg_dump -U shoppa shoppa > shoppa-$(date +%F).sql
```
