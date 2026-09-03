# Using Shoppa

This page is for the person doing the shopping, not the person who installed it. It assumes
somebody has already got Shoppa running and sent you an invitation link — if that person is you,
start at [installation](installation.md) and come back.

The interface exists in Spanish and English. The labels quoted here are the English ones; the
language follows what your browser asks for and can be changed in Settings.

- [The first five minutes](#the-first-five-minutes)
- [Adding things](#adding-things)
- [The shop tabs](#the-shop-tabs)
- [Categories, and how it learns](#categories-and-how-it-learns)
- [The Unassigned inbox](#the-unassigned-inbox)
- [Ticking things off](#ticking-things-off)
- [Editing an item](#editing-an-item)
- [Watching a price](#watching-a-price)
- [Adding things by voice](#adding-things-by-voice)
- [One list, several people](#one-list-several-people)
- [Putting it on your home screen](#putting-it-on-your-home-screen)

## The first five minutes

A fresh installation has twelve categories, a dictionary of 556 product words in Spanish and
English, and **no shops** — which supermarkets exist is yours to say.

Go to **Settings → Shops** and add the ones you use. A shop has a name, an optional emoji and a
colour, and the arrows reorder them; that order is the order of the tabs at the top of the list and
of the shop groups inside the *All* view, so put the one you visit most first.

Then go back and start typing. That is the whole setup.

## Adding things

The add row sits under the tabs. Type the product and press enter (on a phone keyboard, the *done*
key).

**Where it lands.** If you are on a shop's tab, it goes to that shop. If you are on **All**, the
chip on the right of the add row chooses the destination — any shop, or *Unassigned* — and that
choice is remembered in your browser for next time, so the usual case is one tap at the start and
none afterwards. Adding from **All** shows a short confirmation naming where the item went, because
the row itself may be far down the screen.

**What happens to what you typed.** The row keeps your words exactly as you typed them. Underneath,
Shoppa reduces them to a key: lower case, no accents, no punctuation, and with any leading quantity,
unit or article removed. `2 litros de Leche entera` becomes the key `leche entera`. That key is what
the categorisation and the duplicate check work on.

Two consequences worth knowing:

- **`leche` and `2 litros de leche` are the same item.** Typing the second when the first is already
  on the list does not add a row.
- **Quantities in the text are not turned into a quantity field.** They stay part of the name. If
  you want a real quantity and unit, tap the row and set them ([editing an item](#editing-an-item)).

**Adding something that is already there.** The duplicate check is per key *and per destination*, so
the same product can sit in two different shops on purpose. Within one destination:

- the item is already there, unticked → nothing is duplicated, you keep the row you had;
- the item is there but **ticked off** → it comes back, unticked. This is the everyday case: you
  bought milk on Tuesday, you need milk again on Friday, you type it again and the old row wakes up.

## The shop tabs

Across the top, in this order:

- **🧺 All** — everything, from every shop and the inbox. The badge counts the items still to buy.
  Rows here carry a small tag with the shop they belong to, and are grouped by category with the
  shops in the order you set (inbox items last inside each category).
- **One tab per shop**, with its colour dot and its own count of things still to buy. This is the
  view for actually being in the shop: only that shop's items, grouped by category.
- **🎙️ Unassigned** — the inbox, described below. Its badge is orange, because those items are not
  on anybody's route yet.

The tab you were last on is remembered in that browser, so opening the app in the supermarket puts
you where you left off. If somebody deletes a shop while you have its tab open you land back on
*All*; deleting a shop does not delete its items, they move to *Unassigned*.

Inside a tab, items are grouped into category sections in the order set in **Settings →
Categories**, each with an emoji, a colour and a `done/total` count. A section only appears when it
has something in it, and anything with no category falls into a *No category* section at the end.
Above the sections, a progress bar counts the current tab: *"3 of 19 picked up"*.

## Categories, and how it learns

**You never pick a category to add something.** The bundled dictionary answers for it: `leche
entera` → *Dairy*, `detergente` → *Cleaning*, `frozen peas` → *Frozen*. Matching is done on the key
described above, first by exact hit and then by a looser pass in which every word of a dictionary
entry has to match a word of what you typed — with the longest entry winning, so `queso rallado`
beats plain `queso`. Words of three letters or fewer have to match exactly, which is what stops
`col` swallowing `colacao`.

When nothing matches, the item is simply left with no category and waits in the *No category*
section. It is never guessed at.

**Correcting it teaches it.** Tap a row to open its sheet and pick another category: the label
under *Category* says so out loud. From then on that word goes to the category you chose, for
everybody in the house, and it takes precedence over the factory answer. The same happens when you
assign an item to a shop — Shoppa remembers that shop as that product's usual one.

Two honest details about the learning:

- **Clearing a category teaches nothing.** Deselecting the category on a row leaves that row without
  one but does not unlearn anything; to change the answer, choose the right category rather than
  none.
- **A learned "usual shop" never moves an item on its own.** It is used to highlight the suggested
  shop in the inbox, which is one tap away from being wrong. Nothing is filed into a shop behind
  your back.

**The dictionary is a screen.** **Settings → Dictionary** lists every word Shoppa knows, with a
search box and a badge on each: *Factory* for the ones it shipped with, *Learned* for the ones the
house has corrected. Each row has a category and a usual shop you can change from a dropdown — any
change you make marks the row *Learned* — and a bin that deletes the entry outright. A deleted
entry stays deleted, including across upgrades: the seed never puts back a row somebody removed.

The list shows 100 entries at a time; narrow the search to reach the rest.

**Categories themselves** are editable in **Settings → Categories**: rename, change the emoji,
reorder, add your own, delete one you never use. The twelve factory ones are shown in the language
of the interface until you rename one — after that your name is used in both languages, because a
name you typed must not be overwritten by a language switch. Deleting a category leaves its items
with no category and removes its dictionary entries, so it asks first.

## The Unassigned inbox

The inbox is where things go when nobody has decided which shop they are for. Two things land here:
anything dictated to Siri (marked with a 🎙️), and anything you add from *All* with the destination
chip on *Unassigned*.

Each card offers a row of shop chips: one tap sends the item to that shop. The chip Shoppa thinks is
right — from the usual shop it learned for that product — is outlined in the accent colour, so the
common case is confirming rather than choosing. When more than one item is waiting there is a **Send
EVERYTHING to** row at the top that empties the inbox into one shop in a single tap.

You cannot tick items off from the inbox tab; assign them first, or tick them from *All*. It is a
sorting screen, not a shopping one — the point is that couch work and shop work are different jobs.

## Ticking things off

Tap the circle at the left of a row. It fills, the name is struck through, the row goes quiet and
drops to the bottom of its section, and the progress bar moves. Tap again to undo it. Nothing is
deleted by ticking.

**Clear ticked** appears at the bottom once at least one thing in the current tab is ticked, with
the count next to it:

- on a **shop tab**, it deletes that shop's ticked items straight away;
- on **All**, it asks for confirmation first — because it clears every shop *and* the inbox, where
  the things Siri removed are sitting recoverably.

**And if you never press it:** a ticked item is deleted on its own **fourteen days** after it was
ticked. The clean-up runs whenever somebody opens the list, so it happens quietly, next time anybody
looks. Unticking an item before then resets the clock. Items that are *not* ticked are never removed
automatically, however long they sit there.

The list re-reads itself every fifteen seconds while it is on the screen, so two people shopping in
different aisles see each other's ticks without doing anything. Your own taps show instantly and are
sent in the background.

## Editing an item

Tapping the name, or the pencil, opens the item sheet:

- **Name** — free text; correcting it re-files the item, since the category is looked up from the
  name.
- **Quantity** and **Unit** — a number and a chip (`ud`, `kg`, `g`, `L`, `ml`, `paq`, `lata`,
  `bote`). Both optional; they show as a small grey annotation on the row.
- **Category** — the chips described above. Choosing one teaches it.
- **Shop** — move the item to another shop, or back to *Unassigned*. Choosing a shop teaches that
  product's usual shop.
- **Delete** — removes this row now, ticked or not. It is the only way to take something off the
  list without buying it and without waiting.

## Watching a price

The 📉 button at the top right of the list opens **Prices**.

**Adding a product.** Paste the product's URL and press *Read*. Shoppa fetches the page and shows
you what it understood: the shop, the product name (editable), the image, and the prices it found.
When a page offers more than one — an offer, a struck-out list price, a number in the page's
metadata — they appear as chips and you pick the right one. Whatever ends up in the **Reference
price** box is what every future alert is measured against, so it is worth a second of attention;
you can also just type it.

If the shop refuses to be read, Shoppa says so and lets you type the reference by hand. It never
invents a number. The product is still tracked, and it keeps trying every morning.

**What the card shows.** The current price large, the reference next to it, the percentage change,
when it was last checked and the lowest price ever seen. If the page has failed three times running,
the card says it cannot be read and gives the reason instead.

The buttons under each card:

| | |
|---|---|
| ↻ **Check now** | Runs exactly what the morning run would do, this second, alert rule included. |
| ◎ **Use the current price as the reference** | For a product you added at a bad moment and which would therefore never alert again. Asks first. |
| ⏸ **Pause / resume** | Keeps the product and its history, stops the daily reading. |
| ↗ **Open in the shop** | The original page. |
| 🗑 **Stop tracking** | Removes the product and its price history. Asks first. |

**The alert.** Every morning Shoppa re-reads each tracked page and stores the reading. A Telegram
message goes out when a price is **below the reference and was not already below it** — so a product
that stays cheap for a week buzzes once, not seven times, and can alert again after it climbs back
up and drops a second time. The message names the product, the new price, the old one, the
percentage, and the lowest it has ever been.

If a shop cannot be read three times in a row, one message says so — once, not once a day — and it
resets the moment the page reads normally again.

Alerts go to Telegram and nowhere else, and whoever installed Shoppa has to configure that bot;
**Settings → Telegram alerts** explains it and has a button that sends a test message. Without it,
everything else still works: prices are read, history is kept, drops still show on the card. You
just do not get told.

## Adding things by voice

On iOS you can build a shortcut in a couple of minutes so that *"Hey Siri, add to the shopping
list"* puts a dictated item straight on the list. **Settings → Siri shortcut** walks through it with
your own instance's addresses already filled in; [docs/siri-shortcut.md](siri-shortcut.md) is the
same guide in writing.

From the user's side:

- **Get your own token.** Same screen: give it the name of your phone and press *Generate*. It is
  shown once — copy it into the shortcut there and then. Everybody in the house makes their own; the
  screen lists the ones that exist, when each was last used, and revokes any of them if a phone goes
  missing.
- **Adding.** Say the trigger phrase, then dictate the product — Siri needs two turns and will not
  take both in one sentence. The item lands in **Unassigned**, categorised, and the reply tells you
  which category it went to. Somebody then sends it to a shop from the inbox, or you do, later.
- **Removing.** The second shortcut ticks off the most recent matching item, wherever it is — any
  shop or the inbox. It matches loosely, so a dictation variant still finds it; and it **ticks
  rather than deletes**, so a mistake is one tap away from being undone. If nothing matched it says
  so out loud rather than doing nothing quietly.
- **Tracking a price from anywhere.** The third shortcut lives in the iOS share sheet: from a
  product page, *Share → Track price*. The price on that page becomes the reference. If the shop
  blocks the read it tells you and creates nothing, rather than starting a watch with nothing to
  compare against.
- **The replies come back in Spanish by default**, because a shortcut carries no browser and so no
  language preference. Adding an `Accept-Language: en` header to the shortcut's request gets you
  English.

## One list, several people

Shoppa is one household, and everybody in it is equal. There are no roles, no per-item owners and no
private sections: if you can sign in, you can see and change everything, and you can invite the next
person.

**Being invited.** Whoever is already in creates a link in **Settings → Invite someone**. It works
once and expires after 72 hours. Opening it asks for an email address and either a password or a
passkey, and from that moment you are in — the same list, the same everything.

**Signing in.** The login screen leads with the passkey button and keeps the password one discreet
tap away, behind *Sign in with a password*. On a plain-HTTP address on your own network passkeys are
impossible in the browser itself: the button is there but disabled and says so, and the password
behind that link is the way in. You can add a passkey later from Settings — but note
that **adding one deletes that account's password**, which the screen warns about before it does it.
Settings lists the passkeys the account holds and can remove one, and it refuses to remove the last
way into an account.

**What is yours alone.** Three things are per browser rather than shared: the language, the theme,
and which tab you were last on. One more is per person: the Siri token. Everything else — the list,
the shops, the categories, the dictionary, the tracked prices — is the household's.

## Putting it on your home screen

Shoppa is a PWA. In Safari, *Share → Add to Home Screen*; in Chrome, *Install app*. It opens
full-screen without browser chrome and behaves like an app.

It is **online-only by design**: the list is never cached on the device, so with no connection you
get an offline page rather than a stale list. A shopping list that quietly shows you yesterday's
version while somebody at home is editing today's is worse than one that admits it cannot reach the
server.

The theme is a switch in Settings — light or dark, remembered in that browser. It does not follow
your device's setting.
