"use client";

import { useSyncExternalStore } from "react";

/**
 * Passkey support, read after hydration instead of during render.
 *
 * `window.isSecureContext` and `"PublicKeyCredential" in window` are browser
 * facts that the server cannot know. Reading them straight in the render body
 * makes the server emit one branch and the client another, and React then
 * patches the difference silently: the whole passkey block flips a beat after
 * the page appears. `useSyncExternalStore` is the sanctioned way to say "this
 * value does not exist on the server" — the server snapshot is false, the
 * client snapshot is the real capability, and the swap happens as a normal
 * commit rather than as a hydration repair.
 *
 * The store never changes after load, so `subscribe` has nothing to listen to.
 */
const neverChanges = () => () => {};
const unsupportedOnServer = () => false;

function readSecureContext(): boolean {
  return window.isSecureContext;
}

function readWebAuthn(): boolean {
  return "PublicKeyCredential" in window;
}

/** True once the client confirms the page runs in a secure context. */
export function useSecureContext(): boolean {
  return useSyncExternalStore(neverChanges, readSecureContext, unsupportedOnServer);
}

/** True once the client confirms the browser exposes the WebAuthn API. */
export function useWebAuthnSupport(): boolean {
  return useSyncExternalStore(neverChanges, readWebAuthn, unsupportedOnServer);
}
