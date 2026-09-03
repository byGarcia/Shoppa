import "server-only";
// Single source of truth for WebAuthn relying-party config.
// A fresh install needs nothing: both values default to APP_ORIGIN. The
// explicit variables exist because rpID is baked into every credential when it
// is registered and cannot be re-derived afterwards. An instance whose passkeys
// were created under a different id — a parent domain, or simply the host it
// answered on before it moved — has to be told that id, or none of those
// passkeys is offered again.

import { appOrigin } from "@/lib/env";

const RP_NAME = "Shoppa";

/** Effective TLD+1 of the relying-party origin. Explicit env wins; otherwise
 *  it is the host of APP_ORIGIN. An existing deployment MUST keep setting it:
 *  changing rpID invalidates every passkey already registered.
 *
 *  A variable that is present but empty is a mistake, not a request to derive.
 *  `.env.example` uses `NAME=` for "unset" elsewhere, so silently deriving here
 *  would turn a stray blank line into a permanently unusable passkey. */
function getRpID(): string {
  const id = process.env.WEBAUTHN_RP_ID;
  if (id !== undefined && id.trim() === "") {
    throw new Error("WEBAUTHN_RP_ID is defined but empty: delete the line or give it a value.");
  }
  if (id) return id;
  return appOrigin().hostname;
}

/** Full origin (protocol + host) of THIS app. Explicit env wins; otherwise
 *  it is APP_ORIGIN itself. Empty-but-defined throws, same reasoning. */
function getOrigin(): string {
  const o = process.env.WEBAUTHN_ORIGIN;
  if (o !== undefined && o.trim() === "") {
    throw new Error("WEBAUTHN_ORIGIN is defined but empty: delete the line or give it a value.");
  }
  if (o) return o;
  return appOrigin().origin;
}

export const WEBAUTHN_CONFIG = {
  rpName: RP_NAME,
  get rpID() {
    return getRpID();
  },
  get origin() {
    return getOrigin();
  },
};
