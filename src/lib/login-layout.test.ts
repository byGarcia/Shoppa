import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { loginLayout } from "./login-layout.ts";

/**
 * The report: with AUTH_MODE=auto the screen offered a passkey button and,
 * right below it and with the same weight, a password field. Every account
 * migrated from the previous application has a passkey and does NOT have a
 * password: for all of them that field could never work.
 *
 * It gets reordered, not removed. The server cannot know which of the two the
 * person looking at the screen has, and above all must not find out: a screen
 * that showed the field only to accounts that have a password would be
 * answering "does this address exist here, and how does it get in?" to anyone
 * who types an email.
 */
describe("what the login screen offers in each AUTH_MODE", () => {
  it("auto: the passkey is the action and the password waits behind a control", () => {
    expect(loginLayout("auto")).toEqual({ passkey: true, passwordSlot: "behind-reveal" });
  });

  it("passkey: there is no password to reveal, not even a hidden one", () => {
    expect(loginLayout("passkey")).toEqual({ passkey: true, passwordSlot: "absent" });
  });

  it("password: with no passkey button, the password is not the second option but the form itself", () => {
    // Hidden behind a control would mean hiding the only door there is.
    expect(loginLayout("password")).toEqual({ passkey: false, passwordSlot: "primary" });
  });

  it("in all three modes the screen has at least one way in", () => {
    for (const mode of ["auto", "passkey", "password"] as const) {
      const layout = loginLayout(mode);
      expect(layout.passkey || layout.passwordSlot !== "absent", mode).toBe(true);
    }
  });

  // What does NOT come in through the door: the function receives neither the
  // email, nor the account, nor anything read from the database. Its only
  // input is the instance configuration, the same for everyone who visits it.
  it("the same instance shows the same thing to everybody", () => {
    expect(loginLayout("auto")).toEqual(loginLayout("auto"));
    expect(loginLayout.length).toBe(1);
  });
});

describe("the login screen texts", () => {
  it("the control that reveals the password is in both catalogs", () => {
    expect(es.login).toHaveProperty("passwordReveal");
    expect(en.login).toHaveProperty("passwordReveal");
  });

  it('the field label no longer says "or", which was false with no passkey button', () => {
    // With AUTH_MODE=password there is no other option for this one to be the
    // alternative to, and "O entra con tu contraseña" read as if there were.
    expect(es.login.passwordLabel).not.toMatch(/^O /);
    expect(en.login.passwordLabel.toLowerCase()).not.toMatch(/^or /);
  });

  it("and the line under the button no longer promises that there are no passwords here", () => {
    // It sat right above the control that offers one.
    expect(es.login.passkeyHint).not.toContain("Sin contraseñas");
    expect(en.login.passkeyHint).not.toContain("No passwords");
  });
});
