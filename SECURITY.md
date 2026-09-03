# Security policy

Shoppa authenticates people, stores passkeys and password hashes, and is meant to be installed by
strangers on machines the author will never see — sometimes on the open internet. Reports are
welcome and taken seriously.

## Supported versions

There are no releases or tags yet. **The supported version is the latest commit on `main`.** Fixes
land there; there is no back-porting to anything older, and an instance more than a few commits
behind should update before reporting.

## Reporting a vulnerability

**Do not open a public issue, a pull request or a discussion.**

Use GitHub's private vulnerability reporting, which is enabled on this repository:

> **[Report a vulnerability](https://github.com/byGarcia/Shoppa/security/advisories/new)**
> — or the *Security* tab → *Advisories* → *Report a vulnerability*.

The thread is private between you and the maintainer, and it becomes the advisory if the report is
confirmed. It needs no email address, no key exchange and no account beyond the GitHub one you
already have to read this.

Please include:

- What an attacker gains, and what they need in order to get it — an unauthenticated stranger, a
  household member with an account, or somebody who is already on the same LAN.
- The commit SHA you tested.
- `APP_ORIGIN`'s scheme, `AUTH_MODE`, `TRUSTED_PROXY` and `PRICE_FETCH_MODE`. All four change what
  the application enforces, and a finding under one setting may not exist under another.
- The shortest reproduction you have.
- **No secrets.** Never paste `AUTH_SECRET`, `POSTGRES_PASSWORD`, `TELEGRAM_BOT_TOKEN`,
  `N8N_API_KEY`, a voice token, an install token or an invitation link — not even a spent one.

This is a spare-time project maintained by one person. Expect an acknowledgement within a week. If
a week passes with silence, a bump on the same private thread is welcome. You will be credited in
the advisory unless you ask not to be.

## In scope

Anything in this repository, running as `compose.yaml` runs it:

- Authentication and session handling: the password login and its throttle, the WebAuthn passkey
  ceremonies, session cookies and token versioning.
- The install token and the `/setup` flow that claims an unclaimed instance.
- Invitation links: single use, hashed at rest, 72 hours to live.
- The voice tokens and the endpoints they authenticate.
- Rate limiting and the client-IP derivation behind `TRUSTED_PROXY`.
- The API routes and anything that lets one instance's data be read or written without an account.
- Injection, XSS, CSRF, SSRF, path traversal, and the security headers set in `src/proxy.ts` and
  `next.config.ts`.
- Password storage: scrypt, `N=65536, r=8, p=1`, per-password salt, constant-time comparison.
- Secrets reaching somewhere they should not: the log, the client bundle, an error message.
- Dependency vulnerabilities that are actually reachable from Shoppa's own code.

## Out of scope

- The security of a deployment's own environment: a weak `AUTH_SECRET`, a reverse proxy that
  forwards headers it should overwrite, an exposed PostgreSQL port, an unpatched host.
- Denial of service by volume, and anything that only works with `docker compose exec` or shell
  access on the host — that access is already game over, and one feature depends on it (below).
- Missing hardening that is not exploitable on its own: an absent header that changes nothing, a
  cookie flag that the transport already covers, self-XSS.
- Reports from an automated scanner with no working reproduction against a running instance.
- The four points below. They are decisions, documented before they were built, and reporting one
  is not a finding — though an argument that a decision is *wrong* is a perfectly good issue.

## Deliberate decisions that may look like vulnerabilities

**Registering a passkey deletes that account's password.** Not disables — deletes. A disabled hash
is a dormant secret that one `UPDATE` revives, and an account with both a passkey and a password is
only as strong as the password. The interface asks for the current password (or an existing
passkey) first and spells out what is being given up. This version has **no screen to set a password
again**: the only way back is `scripts/auth-password.mjs`, run inside the container, which reads the
new password from a terminal with echo off, kills that account's open sessions and records the
reset. Shell access on the host is the level of proof this deserves. It is on the list in
[PRODUCT.md](PRODUCT.md) of what was left for later, and
[docs/installation.md](docs/installation.md) documents the procedure.

**With `TRUSTED_PROXY=none`, per-IP rate limiting is off.** This is the default. Behind a proxy the
socket address is the proxy's, so the client address can only come from a header — and a header any
caller can set is not evidence. A bucket keyed on a value the attacker picks is a fresh bucket per
attempt, which is worse than none, so Shoppa keys nothing at all. What is left is a per-account
throttle (five consecutive failures, fifteen minutes, no header can forge it), a flat ceiling of 30
requests a minute on each sensitive route and an instance-wide ceiling on failed logins. **An
instance reachable from the internet belongs behind a reverse proxy you control**, with
`TRUSTED_PROXY` set to match the header that proxy writes. Configuring it turns the per-IP buckets
on. See [docs/installation.md](docs/installation.md).

**There is no multi-tenancy and no per-user permissions.** One instance is one household. Everybody
who can sign in sees and edits every item, shop, category and tracked price, and **anybody with an
account can create an invitation link for the next person**. That is the product, not an oversight:
the only per-user rows in the database are the voice tokens. If you need separate lists for separate
groups, run separate instances. See [PRODUCT.md](PRODUCT.md).

**The install token is printed to the container log.** While — and only while — the instance has no
account, the token is printed on the first request of every boot, so that an interrupted install can
be resumed. It stops being printed and stops working the moment the first account exists. Anybody
who can read your container log can claim an unclaimed instance; set `SETUP_TOKEN` yourself if that
is not acceptable in your environment, and do not leave a fresh instance unclaimed and reachable.

One more thing that is honest rather than deliberate: the content-security policy allows images from
any `https` origin, because tracked products' thumbnails are loaded straight from each shop's own
servers. That is a real widening of `img-src` and it is written down here so nobody has to discover
it.
