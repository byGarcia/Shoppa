# Price tracking

Paste a product URL on the Prices screen. Shoppa reads the page, shows you the prices it found,
and keeps the one you pick as the **reference**. From then on it reads that page once a day,
stores every reading as history, and sends a Telegram message when the price falls below the
reference.

If the shop cannot be read it says so and lets you type the reference by hand. It never invents a
price.

- [How a check works](#how-a-check-works)
- [The two fetch modes](#the-two-fetch-modes)
- [`assisted` mode: the three endpoints](#assisted-mode-the-three-endpoints)
- [The schedule](#the-schedule)
- [Telegram](#telegram)

## How a check works

**Adding a product.** The URL is checked before it is stored: it must resolve to a public address,
and so must every redirect it follows. A URL pointing into your own network is refused. This
matters more than it looks — in `assisted` mode the page is fetched from inside your network, and a
stored `http://192.168.1.10/` would be a daily request against whatever answers there.

**Reading the page.** One HTTP request with a full browser header set, a 10-second timeout, at
most four redirects and a 4 MB cap. Shops that wall a cookieless request get a session primed
first and one retry. The extractor prefers the source the reference price came from, and within it
the reading nearest the reference — the offer, not a struck-out list price.

**The sanity guard.** A reading more than ten times the reference, or less than a tenth of it, is
recorded as a failed read rather than a price. This is what stops a captcha page whose only number
is an accessory's 12.99 from firing a "huge drop" alert.

**The alert rule.** A message goes out when a reading is below the reference **and the product was
not already below it**. It does not repeat every morning while the price stays down; it can fire
again once the price has gone back up to the reference and dropped a second time. The lowest
price ever seen, and when, is kept alongside.

**Failures.** A product that cannot be read keeps its previous data and counts a failure. After
three consecutive failures one Telegram message is sent, once — not one a day. The counter and the
message reset as soon as the page reads again.

**The daily pass.** Every active product that has not already been checked on the current UTC day,
oldest check first, four at a time, with a time budget of about 55 seconds. Whatever does not fit
is picked up by the next pass, because the state lives in each product's row rather than in the
run. Re-running the pass on the same day retries only what failed and re-notifies nothing.

Note that the "already checked today" guard is measured in UTC, while the schedule below is
measured in `TZ`. On a `TZ` far from UTC that means the two boundaries do not line up; with one
run a day it makes no practical difference, but it is worth knowing before you schedule two.

## The two fetch modes

`PRICE_FETCH_MODE` picks one. The default is `local`, and most people should stay there.

### `local` (default)

Shoppa downloads the product page itself and extracts from it. There is no browser engine involved
— no Playwright, no Puppeteer, nothing to install — just an HTTP request and a parser.

This works against any shop that does not block datacenter addresses, which is most of them. The
ones that do (large marketplaces are the usual case) answer a bot wall instead of a product page.
Shoppa recognises that and records a typed failure; the product stays in the list with its last
known price and the reason it could not be read, and you can set the reference by hand.

In `local` mode the three machine-to-machine fetch endpoints are disabled and answer **410 Gone**.
Nothing waits for an external helper, which matters: waiting 30 seconds per product for a fetcher
that does not exist is how a working install looks broken.

### `assisted`

For shops that refuse your server but serve a normal residential connection. You run a small
fetcher **inside your own network**; it asks Shoppa what to download, downloads it from your home
address, and posts the HTML back. Shoppa keeps all the logic — extraction, the sanity guard, the
alert decision — so the result is identical to a local read; only the download moves.

The direction matters. The fetcher calls Shoppa, never the other way round, so there is no inbound
path into your network and no tunnel to secure.

Shoppa does not ship that fetcher. It is a loop of a few lines around `curl` or a headless browser;
what it must speak is below.

`assisted` needs `N8N_API_KEY` set to a long random string. Every endpoint below authenticates
with `Authorization: Bearer <N8N_API_KEY>` and answers 401 to anything else, 500 while the variable
is unset.

**About that name.** `N8N_API_KEY` is the bearer key of these endpoints and has nothing to do with
any workflow runner; it is a leftover from the deployment this code grew up in. Renaming it would
break the environment of every existing instance for a cosmetic gain, so it stays. Read it as
"price API key".

## `assisted` mode: the three endpoints

Two of them are the daily pass; the third serves live reads (the "check now" button and the
preview when you add a product).

### `GET /api/prices/queue`

The morning work list: every active product not yet checked today.

```json
{ "products": [ { "id": "…", "url": "https://…" } ] }
```

### `POST /api/prices/ingest?id=<id>`

The page your fetcher downloaded. The request body is the **raw HTML** — no JSON wrapper. Optional
`&finalUrl=<url>` if you followed redirects. On a failure, post with `&error=<message>` and an
empty body, so the product records the reason rather than going silent.

The response is the outcome of the check, wrapped in an `outcome` object:

```json
{
  "outcome": {
    "productId": "…",
    "status": "alerted",
    "price": 24.9,
    "telegram": "…the message to send…"
  }
}
```

`status` is one of `ok`, `alerted`, `failed` or `skipped`. `reason` carries the explanation when it
is `failed`; `price` is absent when there is no reading.

**In this mode Shoppa decides but does not deliver.** If the reading triggers an alert, the
response carries `outcome.telegram` — note the nesting; `body.telegram` is `undefined` — containing
the message text, and sending it is the fetcher's job. This is unconditional: the route always
defers. It exists so the bot token can stay on the machine inside your network and never be copied
onto the server. **A fetcher that ignores this field silently sends nothing**, and the price-drop
alert is the feature you installed this for. If you would rather Shoppa sent the message itself,
set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` on the server and use the built-in schedule instead
of an external one.

### `GET` / `POST /api/prices/fetch-jobs`

The live mailbox, for reads that happen while somebody is looking at the screen. `GET` returns the
pages Shoppa wants downloaded from your network — either because its own attempt was walled, or
because the shop is one it already knows walls this host:

```json
{ "jobs": [ { "id": "…", "url": "https://…" } ] }
```

Poll it every few seconds. `POST /api/prices/fetch-jobs?id=<id>` with the raw HTML as the body
completes the job and unblocks whoever is waiting; `&error=<message>` reports a failure.

A job is handed out **once** and expires after 60 seconds; the request waiting on it gives up
after 30 and falls back to reading the page locally. The queue is in memory, which is the reason
Shoppa must run as a **single container**: with two replicas the fetcher would complete jobs on the
instance that did not create them, and previews would hang.

### `POST /api/prices/check`

Runs a whole pass on the server, fetching locally. Same bearer key, and the one price endpoint that
stays open in `local` mode. `?force=1` ignores the "already checked today" guard. Useful for a
manual run or an external scheduler; it is not needed when the built-in schedule is on.

## The schedule

Shoppa runs its own daily pass. There is nothing to configure outside the container: no cron on
the host, no external caller, no API key involved.

- **`PRICE_CHECK_CRON`**, default `0 8 * * *` — eight in the morning.
- **`PRICE_CHECK_CRON=off`** disables it, which is what you want if something outside is already
  triggering the run.
- The expression is five fields. Minute and hour accept `*`, a number and `*/n`; the day-of-month,
  month and day-of-week fields must be `*`. Ranges, lists, names and the `@daily` shorthands are
  refused by name rather than half-supported.

**An expression the parser cannot read does not stop the instance.** It is reported at full volume
in the log and no daily pass is scheduled, because a schedule nobody can read is not a reason to
refuse to serve the shopping list. The consequence is that a typo here is silent from the outside:
read the log after changing it. The same applies to an unknown `TZ`.

**`TZ` is the trap.** The expression is evaluated in the container's timezone, and a container is
**UTC** unless you tell it otherwise. Left alone, `0 8 * * *` fires at 09:00 or 10:00 local across
most of Europe, and the clock moves under you twice a year. Set it next to the schedule:

```bash
PRICE_CHECK_CRON=0 8 * * *
TZ=Europe/Madrid
```

Daylight saving is handled by walking real instants rather than by arithmetic: an 08:00 that does
not exist on a spring-forward morning is skipped rather than fired an hour late.

**If the appointment passes while the container is down**, the next boot notices — it asks whether
anything has been checked since the last appointment, not whether anything has been checked today —
and catches up. A host that reboots nightly still gets its price run.

**Do not run two schedules.** If you use `assisted` mode with a fetcher that decides when to work,
turn the internal one off with `PRICE_CHECK_CRON=off`. Leaving both on checks every tracked
product twice a day for nothing.

## Telegram

Price alerts go to Telegram, and only there. Create a bot with BotFather, get the chat id of the
chat you want the messages in, and set:

```bash
TELEGRAM_BOT_TOKEN=…
TELEGRAM_CHAT_ID=…
```

`TELEGRAM_TOKEN` is accepted as an alias for the first one, because a bot token is often already
stored somewhere under that name and copying the name along with the value is the obvious mistake
to make.

Both, or neither works. Missing configuration is not an error: the daily pass still runs, still
records history and still marks drops in the interface, and the log carries one warning saying
alerts are not being sent. A missing token must never take the price run down with it.

Settings has a Telegram screen that sends a test message so you can check the two values without
waiting for a price to move.
