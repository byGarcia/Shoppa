"use client";

import { useEffect } from "react";

export function SWRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.error("SW registration failed:", err);
    });
  }, []);
  return null;
}
