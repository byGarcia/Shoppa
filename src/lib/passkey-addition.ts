/**
 * What adding a passkey will actually do to an account — which is what the
 * settings card has to say before it offers the button.
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
