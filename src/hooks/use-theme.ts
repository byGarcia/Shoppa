"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "compra-theme";
const listeners = new Set<() => void>();

function isDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-theme") === "dark";
}

function apply(next: boolean) {
  const root = document.documentElement;
  if (next) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
  } catch {
    /* private mode / storage disabled — theme still applies for the session */
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/**
 * Light/dark theme, persisted in localStorage and applied as
 * `data-theme="dark"` on <html>. The pre-paint bootstrap in layout.tsx sets the
 * initial attribute; this hook reads it as external state (SSR snapshot: light)
 * and toggles it. useSyncExternalStore keeps every consumer in sync.
 */
export function useTheme() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  const toggle = useCallback(() => apply(!isDark()), []);
  return { dark, toggle };
}
