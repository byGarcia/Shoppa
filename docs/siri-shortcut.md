# Adding to the list by voice

iOS Shortcuts can talk to Shoppa directly, so "Hey Siri, add to the shopping list" puts a dictated
item straight into the list — filed under its category, visible to everybody in the house.

There is nothing to install. A Shortcut is three actions around one HTTP request, and Shoppa gives
you the token it authenticates with. The same guide, with your own instance's URLs already filled
in, is in the app under Settings → Siri shortcut.

- [The token](#the-token)
- [The endpoints](#the-endpoints)
- [Building the "add" shortcut](#building-the-add-shortcut)
- [Building the "remove" shortcut](#building-the-remove-shortcut)
- [Optional: track a price from the share sheet](#optional-track-a-price-from-the-share-sheet)
- [Notes](#notes)

## The token

In the app: **Settings → Siri shortcut**. Give the token the name of the phone it will live on and
press Generate.

- The token is shown **once**. Copy it there and then; Shoppa stores only its SHA-256 hash and
  cannot show it again.
- **Each person generates their own**, from their own session. Items added by voice are recorded
  against whoever owns the token.
- The same screen lists the tokens that exist, when each was last used, and revokes any of them.

Treat it as a password. It carries no session and is checked on its own: anybody holding it can
add to and remove from your household's list. If a phone is lost, revoke that token and generate
another.

## The endpoints

Both take `Authorization: Bearer <your token>` and a JSON body, and both answer with

```json
{ "ok": true, "message": "…" }
```

where `message` is the sentence the Shortcut shows you — and Siri reads out loud. It is written as
copy, not as a status code, so wiring the Shortcut to display it is the whole error handling you
need.

| Endpoint | Body | What it does |
|---|---|---|
| `POST /api/ingest/voice` | `{"text": "milk"}` | Adds the item to the inbox ("Unassigned"), categorized automatically. If the same item is already there but ticked off, it comes back rather than being duplicated. The reply names the category it went to. |
| `POST /api/ingest/remove` | `{"text": "milk"}` | Ticks off the most recent unticked item matching that text, across every shop and the inbox. Exact match first, then a whole-name fuzzy pass, so a dictation variant still finds it. It **ticks, never deletes**, so a mistake is recoverable. A miss answers "Not found" rather than silently doing nothing. |

Prefix both with your `APP_ORIGIN`, for example
`https://shopping.example.com/api/ingest/voice`. The Settings screen prints them with the origin
this browser reached the instance on, which saves typing them wrong.

Wrong or revoked token: `401`, with `ok: false` and a message saying so.

## Building the "add" shortcut

In the iOS Shortcuts app, "+" for a new shortcut, then:

1. **Dictate Text** — set the language you speak.
2. **Get Contents of URL**:
   - URL: `https://<your instance>/api/ingest/voice`
   - Method: `POST`
   - Request Body: `JSON`, with one field `text` set to the **Dictated Text** variable
   - Header: `Authorization` = `Bearer <your token>`
3. **Show Result** — the `message` value from the response dictionary.

Name it "Add to the shopping list". That name is the phrase Siri listens for.

## Building the "remove" shortcut

Duplicate the one above, change the URL to `/api/ingest/remove`, and rename it "Remove from the
shopping list". Nothing else changes.

## Optional: track a price from the share sheet

A third shortcut sends a product page to price tracking from wherever you are browsing.

1. New shortcut, turn on **Receive what is shared**, type: URLs.
2. **Get Contents of URL**:
   - URL: `https://<your instance>/api/ingest/track`
   - Method: `POST`
   - Request Body: `JSON`, with one field `url` set to the **Shortcut Input** variable
   - Header: `Authorization` = `Bearer <your token>` — the same token
3. **Show Result** with `message`.
4. Turn on **Show in Share Sheet**.

From any shop's page: Share → Track price. The price on the page becomes the reference. If the
shop cannot be read, it tells you and creates nothing, rather than starting a watch with nothing
to compare against. If the product is already tracked it says so.

## Notes

- **Siri needs two turns.** "Hey Siri, add to the shopping list", then dictate the product. It will
  not take both in one sentence.
- **The replies come back in Spanish by default.** A Shortcut sends no cookie, so Shoppa cannot
  know your language preference; it reads `Accept-Language` and falls back to Spanish. Add an
  `Accept-Language: en` header in the same place as the `Authorization` one to get English.
- **Rate limit.** The ingest endpoints allow five requests a minute per address, which is generous
  for a person and hostile to anything guessing at tokens. If your instance runs with
  `TRUSTED_PROXY=none` there is no per-address limit and a flat ceiling of 30 requests a minute
  applies to the route as a whole.
- **These endpoints are reachable without a session**, by design: a Shortcut cannot hold one. That
  is why the token is the only thing standing between the internet and your list, and why the
  endpoints do nothing more than add an item, tick an item, and start a price watch.
