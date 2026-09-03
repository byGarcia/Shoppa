import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {
  closedPasskeyCard,
  passkeyAddition,
  passkeyCopy,
  passkeyUse,
  type PasskeyListEntry,
} from "./passkey-addition.ts";

/**
 * The Settings card asked nothing, and so it told everybody the same thing: that
 * adding the passkey would stop the password from working and that getting it
 * back would take a console on the server. An account migrated from the previous
 * application has a passkey and does NOT have a password: for those, not one
 * word of that was true, and the button offered a deletion that could not happen.
 */
describe("what adding a passkey really does", () => {
  it("with a password, it replaces it: the usual warning was the right one", () => {
    expect(passkeyAddition({ hasPassword: true, passkeyCount: 0 })).toBe("replaces-password");
  });

  it("with a password and passkeys already in place there is still a password to lose", () => {
    expect(passkeyAddition({ hasPassword: true, passkeyCount: 3 })).toBe("replaces-password");
  });

  it("with no password and one passkey, it is one more key", () => {
    expect(passkeyAddition({ hasPassword: false, passkeyCount: 1 })).toBe("additional-key");
  });

  it("with no password and no passkey there is nothing that can be claimed", () => {
    // It cannot happen to anyone with a session — they got in somehow — and the
    // server rejects it anyway. It gets a name of its own instead of being let
    // fall into one of the other two branches.
    expect(passkeyAddition({ hasPassword: false, passkeyCount: 0 })).toBe("unprovable");
  });
});

describe("which copy is shown in each case", () => {
  const withoutPassword = passkeyCopy(passkeyAddition({ hasPassword: false, passkeyCount: 2 }));
  const withPassword = passkeyCopy(passkeyAddition({ hasPassword: true, passkeyCount: 0 }));

  it("an account with no password does NOT get the warning that the password stops working", () => {
    // The reason for this whole fix, in one line.
    expect(withoutPassword.warning).not.toBe("warning");
    expect(withoutPassword.warning).toBe("warningAdditional");
  });

  it("the button on an account with no password does not offer to delete it", () => {
    expect(withoutPassword.confirm).toBe("confirmAdditional");
    expect(es.passkeyCard.confirmAdditional).not.toContain("contraseña");
    expect(en.passkeyCard.confirmAdditional.toLowerCase()).not.toContain("password");
  });

  it("and the warning it does get mentions no password being lost", () => {
    // The text itself, not just the key: it is what whoever opens the card reads.
    for (const text of [es.passkeyCard.warningAdditional, en.passkeyCard.warningAdditional]) {
      expect(text).not.toMatch(/dejará de funcionar|stops your password from working/);
      expect(text).not.toMatch(/consola en el servidor|console on the server/);
    }
  });

  it("nor does the success notice say that from now on they sign in without a password", () => {
    expect(withoutPassword.added).toBe("addedAdditional");
    expect(es.passkeyCard.addedAdditional).not.toContain("sin contraseña");
    expect(en.passkeyCard.addedAdditional.toLowerCase()).not.toContain("no password");
  });

  it("an account with a password keeps the usual warning and button", () => {
    expect(withPassword).toEqual({ warning: "warning", confirm: "confirm", added: "added" });
  });

  it("with nothing to confirm against, no paragraph is rendered", () => {
    // Both alternatives would claim something about this account that nobody has
    // established; the card shows only the refusal (`noWayToConfirm`).
    expect(passkeyCopy("unprovable").warning).toBeNull();
  });

  it("every key it picks exists in both catalogs", () => {
    const states = [
      { hasPassword: true, passkeyCount: 0 },
      { hasPassword: false, passkeyCount: 1 },
      { hasPassword: false, passkeyCount: 0 },
    ];
    for (const state of states) {
      const copy = passkeyCopy(passkeyAddition(state));
      for (const key of [copy.warning, copy.confirm, copy.added]) {
        if (key === null) continue;
        expect(es.passkeyCard, key).toHaveProperty(key);
        expect(en.passkeyCard, key).toHaveProperty(key);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */

const IPHONE: PasskeyListEntry = {
  // The ROW id, which is what the delete route accepts. Never the credential
  // id: that one never leaves src/server/webauthn.
  id: "iphone-row",
  deviceName: "iPhone",
  createdAt: "2026-06-01T09:00:00.000Z",
  lastUsedAt: "2026-09-02T07:14:00.000Z",
};
const NEVER_SIGNED_IN: PasskeyListEntry = {
  id: "mac-row",
  deviceName: "Mac",
  // Both columns default to `now()`: a credential that has never signed in
  // still carries its creation time in `last_used_at`.
  createdAt: "2026-09-01T12:00:00.000Z",
  lastUsedAt: "2026-09-01T12:00:00.000Z",
};

/** An account migrated from the previous application: passkeys and no password. */
function migratedAccount(passkeys: PasskeyListEntry[]) {
  return { hasPassword: false, passkeys };
}

describe("when a passkey was last used", () => {
  it("with a later use date, it names it", () => {
    expect(passkeyUse(IPHONE)).toEqual({ key: "lastUse", at: IPHONE.lastUsedAt });
  });

  it("just registered and never used, it does not invent a day on which nothing happened", () => {
    expect(passkeyUse(NEVER_SIGNED_IN)).toEqual({ key: "neverUsed" });
  });

  it("an unreadable date does not turn into a use", () => {
    expect(passkeyUse({ createdAt: "", lastUsedAt: "" })).toEqual({ key: "neverUsed" });
  });
});

/**
 * The trash button on each row, and the row it is taken away from.
 *
 * An account migrated from the previous application has no password: its
 * passkeys are the only way in there is, and this version has no screen that
 * puts a password back. Deleting the last one is not a mistake you recover from
 * by retrying: it is a locked door with `psql` behind it.
 */
describe("which rows can be removed", () => {
  it("with two keys and no password, either of them", () => {
    const card = closedPasskeyCard({ available: true, account: migratedAccount([IPHONE, NEVER_SIGNED_IN]) });
    expect(card.passkeys.map((p) => p.removable)).toEqual([true, true]);
    expect(card.explainLastKey).toBe(false);
  });

  it("with a single key and no password, neither: it is the only way in", () => {
    const card = closedPasskeyCard({ available: true, account: migratedAccount([IPHONE]) });
    expect(card.passkeys.map((p) => p.removable)).toEqual([false]);
  });

  it("and the card explains it instead of leaving one row different without saying why", () => {
    const card = closedPasskeyCard({ available: true, account: migratedAccount([IPHONE]) });
    expect(card.explainLastKey).toBe(true);
    expect(es.passkeyCard).toHaveProperty("deleteLast");
    expect(en.passkeyCard).toHaveProperty("deleteLast");
  });

  it("with a single key BUT with a password, it can be removed: another door is left", () => {
    const card = closedPasskeyCard({
      available: true,
      account: { hasPassword: true, passkeys: [IPHONE] },
    });
    expect(card.passkeys.map((p) => p.removable)).toEqual([true]);
    expect(card.explainLastKey).toBe(false);
  });

  it("with no keys at all there is nothing to explain", () => {
    const card = closedPasskeyCard({ available: true, account: migratedAccount([]) });
    expect(card.explainLastKey).toBe(false);
  });

  it("each row carries its own row id, which is the handle the route accepts", () => {
    const card = closedPasskeyCard({ available: true, account: migratedAccount([IPHONE, NEVER_SIGNED_IN]) });
    expect(card.passkeys.map((p) => p.id)).toEqual(["iphone-row", "mac-row"]);
  });

  // Hiding the trash button is a courtesy, not the guard: another tab holding
  // the list from a minute ago reaches the route with a row that was true here.
  it("the trash button keys exist in both catalogs", () => {
    for (const key of ["deleteLabel", "deleteConfirm", "deleted", "deleteFailed", "deleteLast"]) {
      expect(es.passkeyCard, key).toHaveProperty(key);
      expect(en.passkeyCard, key).toHaveProperty(key);
    }
  });
});

/**
 * The defect this work is named after. Someone who signs in with their passkey
 * every day would open Settings and find the same card as someone who has none:
 * the same subtitle, the same "Añadir" button and nothing, anywhere, that
 * acknowledged the key they had just used. The card only asked about the account
 * when the panel was opened, so while closed — which is how it sits on screen —
 * it knew nothing.
 */
describe("the closed Settings card", () => {
  const oneKey = closedPasskeyCard({ available: true, account: migratedAccount([IPHONE]) });

  it("with one passkey, it nowhere says the account has none", () => {
    // Neither the first-time subtitle nor the first-key button.
    expect(oneKey.subtitle.key).not.toBe("subtitleReady");
    expect(oneKey.action).not.toBe("add");
    // And it does show it.
    expect(oneKey.passkeys.map((p) => p.deviceName)).toEqual(["iPhone"]);
  });

  it("it says how many there are, counted", () => {
    expect(oneKey.subtitle).toEqual({ key: "subtitleCount", count: 1 });
    const threeKeys = closedPasskeyCard({
      available: true,
      account: migratedAccount([IPHONE, NEVER_SIGNED_IN, { ...IPHONE, id: "another-row" }]),
    });
    expect(threeKeys.subtitle).toEqual({ key: "subtitleCount", count: 3 });
  });

  it("the button offers one more key, not the first one", () => {
    expect(oneKey.action).toBe("addAnother");
  });

  it("with no passkeys it does offer the first one, with the usual copy", () => {
    const emptyCard = closedPasskeyCard({ available: true, account: migratedAccount([]) });
    expect(emptyCard.subtitle).toEqual({ key: "subtitleReady" });
    expect(emptyCard.action).toBe("add");
    expect(emptyCard.passkeys).toEqual([]);
  });

  it("while the server has not answered it claims neither of the two things", () => {
    // Flickering between two claims about the account is exactly the class of
    // defect being fixed here: there is no button to read yet.
    const loadingCard = closedPasskeyCard({ available: true, account: null });
    expect(loadingCard.subtitle).toEqual({ key: "subtitleChecking" });
    expect(loadingCard.action).toBeNull();
    expect(loadingCard.passkeys).toEqual([]);
  });

  it("if the query fails it says so, instead of checking forever", () => {
    const failedCard = closedPasskeyCard({ available: true, account: null, failed: true });
    expect(failedCard.subtitle).toEqual({ key: "checkFailed" });
    expect(failedCard.action).toBeNull();
  });

  it("over http it warns about the connection, but still shows the keys there are", () => {
    // The instance cannot create a passkey there; the ones the account has still
    // exist, and hiding them would once again leave the card saying nothing
    // about the account.
    const insecureCard = closedPasskeyCard({ available: false, account: migratedAccount([IPHONE]) });
    expect(insecureCard.subtitle).toEqual({ key: "subtitleInsecure" });
    expect(insecureCard.passkeys.map((p) => p.deviceName)).toEqual(["iPhone"]);
    expect(insecureCard.action).toBe("addAnother");
  });

  it("every key it picks exists in both catalogs", () => {
    const cards = [
      oneKey,
      closedPasskeyCard({ available: true, account: migratedAccount([]) }),
      closedPasskeyCard({ available: true, account: null }),
      closedPasskeyCard({ available: true, account: null, failed: true }),
      closedPasskeyCard({ available: false, account: null }),
    ];
    for (const card of cards) {
      for (const key of [card.subtitle.key, card.action]) {
        if (key === null) continue;
        expect(es.passkeyCard, key).toHaveProperty(key);
        expect(en.passkeyCard, key).toHaveProperty(key);
      }
    }
    for (const key of ["listTitle", "lastUse", "neverUsed"]) {
      expect(es.passkeyCard, key).toHaveProperty(key);
      expect(en.passkeyCard, key).toHaveProperty(key);
    }
  });
});

describe("the count, exactly as it reads on screen", () => {
  // With the same formatter the application uses: an ICU plural, not two pieces
  // of text glued to a number.
  it("in Spanish it agrees in singular and in plural", () => {
    const t = createTranslator({ locale: "es", messages: es, namespace: "passkeyCard" });
    expect(t("subtitleCount", { count: 1 })).toBe("Ya tienes 1 passkey en esta cuenta");
    expect(t("subtitleCount", { count: 3 })).toBe("Ya tienes 3 passkeys en esta cuenta");
  });

  it("and in English too", () => {
    const t = createTranslator({ locale: "en", messages: en, namespace: "passkeyCard" });
    expect(t("subtitleCount", { count: 1 })).toBe("You already have 1 passkey on this account");
    expect(t("subtitleCount", { count: 4 })).toBe("You already have 4 passkeys on this account");
  });

  it("the first-key button and the one-more-key button do not say the same thing", () => {
    // If they matched, the account with a passkey would read "Añadir" again and
    // the fix would not show up on screen.
    expect(es.passkeyCard.addAnother).not.toBe(es.passkeyCard.add);
    expect(en.passkeyCard.addAnother).not.toBe(en.passkeyCard.add);
  });
});
