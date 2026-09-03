import { redirect } from "next/navigation";

import { authMode, isSecureOrigin } from "@/lib/env";
import { isClaimed } from "@/server/setup";

import { SetupForm } from "./setup-form";

// Same reason as /login: AUTH_MODE and APP_ORIGIN are read per request.
// Prerendering this screen would freeze the mode and the scheme of the machine
// that built the image — which is nobody's — and would decide whether to offer
// a passkey by looking at an origin that does not exist.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Already claimed: this screen can do nothing (claimInstance would refuse the
  // attempt anyway) and leaving it visible only invites token guessing.
  if (await isClaimed()) redirect("/login");

  const mode = authMode();
  return (
    <SetupForm
      // AUTH_MODE is the only thing the server decides here. Whether the
      // browser will let a passkey be created is the browser's own call, made
      // on the client with window.isSecureContext: APP_ORIGIN is wrong about
      // http://localhost, which is a secure context where passkeys work, and a
      // screen that says "you need HTTPS" there is saying something false.
      passkeysAllowedByMode={mode !== "password"}
      appOriginIsHttps={isSecureOrigin()}
      passwordEnabled={mode !== "passkey"}
    />
  );
}
