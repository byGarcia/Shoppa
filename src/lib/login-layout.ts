import type { AuthMode } from "@/lib/env";

/**
 * Where the password field sits on the sign-in screen.
 *
 *  - `absent`      — not on the screen at all, and not reachable from it.
 *  - `behind-reveal` — one discreet control away. It is the *second* way in.
 *  - `primary`     — the only way in, so it is the form.
 */
export type PasswordSlot = "absent" | "behind-reveal" | "primary";

export interface LoginLayout {
  /** Whether the passkey button is rendered at all. */
  passkey: boolean;
  passwordSlot: PasswordSlot;
}

/**
 * What /login shows, decided by AUTH_MODE and by nothing else.
 *
 * **The complaint.** With `AUTH_MODE=auto` the screen offered a passkey button
 * and, right under it, a password field. Every account migrated from the
 * previous application has a passkey and no password: for all of them that
 * field could never work, and it was as prominent as the control that could.
 *
 * **Why it is reordered and not removed.** The server cannot know which of the
 * two a visitor has, and it must not find out before the address is submitted:
 * a screen that showed the password field only to accounts that have one would
 * answer "does this address exist here, and how does it sign in" to anybody who
 * types an address. So the field stays, exactly as available as before, and
 * moves behind a control that says what it is for. Nothing on the screen
 * depends on the visitor, on the address typed, or on any row in the database —
 * this function takes the instance's mode and returns the same answer for
 * everybody hitting that instance.
 *
 * The three modes:
 *
 * | AUTH_MODE  | Passkey button | Password |
 * |------------|----------------|----------|
 * | `auto`     | yes, primary   | behind a reveal control |
 * | `passkey`  | yes, primary   | absent — nothing to reveal |
 * | `password` | no             | the form itself: there is no passkey to be primary |
 *
 * In `password` mode `src/lib/auth.ts` refuses every assertion, so a passkey
 * button there would be a control that cannot work; and with it gone the
 * password is not a second choice hidden behind anything, it is the way in.
 */
export function loginLayout(mode: AuthMode): LoginLayout {
  switch (mode) {
    case "passkey":
      return { passkey: true, passwordSlot: "absent" };
    case "password":
      return { passkey: false, passwordSlot: "primary" };
    case "auto":
      return { passkey: true, passwordSlot: "behind-reveal" };
  }
}
