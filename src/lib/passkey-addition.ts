/**
 * Everything the settings card decides: what it shows about the account it is
 * looking at, and what adding a passkey will actually do to it.
 *
 * It used to say only one of these, to everybody. An account that arrived from
 * an older installation has a passkey and no password, and was still told that
 * its password would stop working and that recovering it meant a console on the
 * server. None of that was true, and the button read as a deletion.
 *
 * Split out of the card because it is the whole of the decision and the card is
 * the one place it cannot be tested: the state is two booleans and the answer
 * is three words.
 */
export type PasskeyAddition =
  /** The account has a password, and registering deletes it. */
  | "replaces-password"
  /** No password to lose: this is a second key alongside the ones it has. */
  | "additional-key"
  /**
   * Neither a password nor a passkey. Unreachable for a signed-in account —
   * it got in with one or the other — and the server refuses it anyway
   * (`passkeyAccountStateFor` answers `reauth: null`, `reauthenticate` answers
   * "unprovable"). Named rather than folded into either neighbour, because
   * both neighbours would state something about this account that nothing has
   * established.
   */
  | "unprovable";

export function passkeyAddition(account: {
  hasPassword: boolean;
  passkeyCount: number;
}): PasskeyAddition {
  if (account.hasPassword) return "replaces-password";
  if (account.passkeyCount > 0) return "additional-key";
  return "unprovable";
}

/** The keys under `passkeyCard` that each state renders. */
export interface PasskeyCopy {
  /**
   * The paragraph above the confirmation — or null, when nothing that could go
   * there has been established.
   */
  warning: "warning" | "warningAdditional" | null;
  confirm: "confirm" | "confirmAdditional";
  added: "added" | "addedAdditional";
}

const ADDITIONAL: PasskeyCopy = {
  warning: "warningAdditional",
  confirm: "confirmAdditional",
  added: "addedAdditional",
};

export function passkeyCopy(addition: PasskeyAddition): PasskeyCopy {
  switch (addition) {
    case "replaces-password":
      return { warning: "warning", confirm: "confirm", added: "added" };
    case "additional-key":
      return ADDITIONAL;
    // The button is disabled here and the card shows the refusal instead, so
    // what these two name is only what a disabled control reads and a toast
    // that will not fire. The neutral wording is the safe one either way; the
    // warning is dropped because there is none to give.
    case "unprovable":
      return { ...ADDITIONAL, warning: null };
  }
}

/* -------------------------------------------------------------------------- */
/*  The closed card: what Settings shows before anybody taps anything          */
/* -------------------------------------------------------------------------- */

/** One passkey as the card lists it. The client half of `PasskeySummary`. */
export interface PasskeyListEntry {
  deviceName: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. Never null — see the server type for why. */
  lastUsedAt: string;
}

/** The second line of a row: the same two facts the voice-token list shows. */
export type PasskeyUse =
  /** Registered and never used since. */
  | { key: "neverUsed" }
  /** Used, at this instant. */
  | { key: "lastUse"; at: string };

/**
 * Whether a passkey has ever signed anybody in.
 *
 * `last_used_at` is not nullable — it defaults to the insert timestamp — so
 * unlike a voice token there is no null to read the answer off. What says it is
 * the comparison: the column is only ever written again by a successful
 * assertion, so a credential still carrying its creation time has never been
 * used. `<=` rather than `===` because the two defaults are evaluated
 * independently and nothing guarantees which lands first.
 */
export function passkeyUse(passkey: Pick<PasskeyListEntry, "createdAt" | "lastUsedAt">): PasskeyUse {
  const created = new Date(passkey.createdAt).getTime();
  const used = new Date(passkey.lastUsedAt).getTime();
  // An unparseable date names no instant, and "never used" is the claim that
  // needs no date to be true.
  if (!Number.isFinite(used) || !Number.isFinite(created)) return { key: "neverUsed" };
  return used <= created ? { key: "neverUsed" } : { key: "lastUse", at: passkey.lastUsedAt };
}

/** The line under the title. Only `subtitleCount` carries a value. */
export type PasskeySubtitle =
  | { key: "subtitleInsecure" | "subtitleChecking" | "checkFailed" | "subtitleReady" }
  | { key: "subtitleCount"; count: number };

/** Everything the closed card renders. */
export interface ClosedPasskeyCard {
  subtitle: PasskeySubtitle;
  /**
   * The button's label — or null while the account has not answered, where the
   * card shows "…" instead. Not a default: "Add" and "Add another" are two
   * different claims about the account, and picking one before the answer
   * arrives is what made the card flicker between them.
   */
  action: "add" | "addAnother" | null;
  /** The rows underneath. Empty renders no list and no heading. */
  passkeys: readonly PasskeyListEntry[];
}

/**
 * What Settings shows for the account, before the panel is opened.
 *
 * This is the fix. The card used to render the same title, the same subtitle
 * and the same "Add" whether the account had no passkeys or five, because the
 * only question it ever asked the server was asked when the panel opened. So
 * somebody who signs in with Face ID every morning was invited, daily, to add
 * his first passkey, with nothing on the screen acknowledging the one he had
 * just used.
 *
 * Kept out of the component for the same reason `passkeyAddition` is: it is the
 * whole of the decision, and the component is the one place it cannot be
 * tested.
 */
export function closedPasskeyCard(input: {
  /** A secure context and a browser that does WebAuthn. */
  available: boolean;
  /** What the server answered, or null while it has not answered. */
  account: { passkeys: readonly PasskeyListEntry[] } | null;
  /** The request failed rather than being still in flight. */
  failed?: boolean;
}): ClosedPasskeyCard {
  const passkeys = input.account?.passkeys ?? [];
  return {
    subtitle: subtitleFor(input, passkeys.length),
    // The list is the account's, not the browser's: an instance served over
    // http still holds these keys and still ought to name them. Only the
    // action is unavailable there.
    action: input.account === null ? null : passkeys.length > 0 ? "addAnother" : "add",
    passkeys,
  };
}

function subtitleFor(
  input: { available: boolean; account: unknown | null; failed?: boolean },
  count: number,
): PasskeySubtitle {
  // First, because it is the reason nothing on this card will work, and it is
  // true regardless of what the account turns out to hold.
  if (!input.available) return { key: "subtitleInsecure" };
  // Neither of the two answers below is established yet. Saying either one and
  // then correcting it is the defect being fixed, one frame wide.
  if (input.account === null) return { key: input.failed ? "checkFailed" : "subtitleChecking" };
  if (count > 0) return { key: "subtitleCount", count };
  // No passkeys: the pitch for the first one, which is what this line has
  // always been. An account here has a password — an account with neither
  // cannot be signed in — so "replaces the password" is true of it.
  return { key: "subtitleReady" };
}
