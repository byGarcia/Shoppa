"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreDTO } from "@/types";

const TAB_KEY = "shoppa-tab";
const DEST_KEY = "shoppa-add-dest";

// What the same two preferences were stored under before the app was named.
const LEGACY_KEYS: Record<string, string> = {
  [TAB_KEY]: "compra-tab",
  [DEST_KEY]: "compra-add-dest",
};

/**
 * Reads the preference, falling back once to the key an older install wrote
 * and moving it across. Hydration is one-shot, so a fallback that did not
 * migrate would be read on every load for the lifetime of that browser.
 */
function readStorage(key: string): string | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored;
    const legacy = localStorage.getItem(LEGACY_KEYS[key]);
    if (legacy === null) return null;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(LEGACY_KEYS[key]);
    return legacy;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — selection still applies for the session */
  }
}

/**
 * Last-used tab. Initial state is always "all" (identical on server and
 * client; localStorage is read only after mount AND once stores have loaded:
 * validating against the initial [] would orphan every stored store tab).
 * Only user-initiated selections write to localStorage; automatic orphan
 * corrections update state WITHOUT writing, so the stored preference survives
 * transient states — the failure mode build+lint cannot catch.
 */
export function useActiveTab(
  stores: StoreDTO[],
  storesReady: boolean,
): [active: string, setActive: (key: string) => void] {
  const [active, setActiveState] = useState<string>("all");
  const hydrated = useRef(false);
  const userTouched = useRef(false);

  // One-shot hydration once stores are known.
  useEffect(() => {
    if (!storesReady || hydrated.current) return;
    hydrated.current = true;
    if (userTouched.current) return; // user tapped before stores resolved
    const stored = readStorage(TAB_KEY);
    if (!stored) return;
    if (stored === "all" || stored === "inbox" || stores.some((s) => s.id === stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration sync from localStorage, not a render loop
      setActiveState(stored);
    }
    // Invalid/orphan id → stay on "all". Never write back.
  }, [storesReady, stores]);

  // Re-validate on store changes (store deleted from the other phone).
  // State-only correction: no localStorage write.
  useEffect(() => {
    if (!storesReady || !hydrated.current) return;
    if (active === "all" || active === "inbox") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing to external store list, not a render loop
    if (!stores.some((s) => s.id === active)) setActiveState("all");
  }, [stores, storesReady, active]);

  const setActive = useCallback((key: string) => {
    userTouched.current = true;
    setActiveState(key);
    writeStorage(TAB_KEY, key);
  }, []);

  return [active, setActive];
}

/**
 * Remembered destination for the "All" tab's add input. Same pattern as
 * useActiveTab: gate on storesReady, user writes only, orphan → null
 * ("Unassigned") without writing. Persisted value "" means null.
 */
export function useAddDestination(
  stores: StoreDTO[],
  storesReady: boolean,
): [dest: string | null, setDest: (value: string | null) => void] {
  const [dest, setDestState] = useState<string | null>(null);
  const hydrated = useRef(false);
  const userTouched = useRef(false);

  useEffect(() => {
    if (!storesReady || hydrated.current) return;
    hydrated.current = true;
    if (userTouched.current) return;
    const stored = readStorage(DEST_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hydration sync from localStorage, not a render loop
    if (stored && stores.some((s) => s.id === stored)) setDestState(stored);
    // "" or orphan id → stay null ("Unassigned"). Never write back.
  }, [storesReady, stores]);

  useEffect(() => {
    if (!storesReady || !hydrated.current || dest === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing to external store list, not a render loop
    if (!stores.some((s) => s.id === dest)) setDestState(null);
  }, [stores, storesReady, dest]);

  const setDest = useCallback((value: string | null) => {
    userTouched.current = true;
    setDestState(value);
    writeStorage(DEST_KEY, value ?? "");
  }, []);

  return [dest, setDest];
}
