import { Suspense } from "react";
import { redirect } from "next/navigation";
import { authMode } from "@/lib/env";
import { isClaimed } from "@/server/setup";
import { LoginForm } from "./login-form";

// AUTH_MODE is read per request, not when the image is built: the same image
// has to serve a passkey-only instance and a password one without a rebuild.
// Prerendering this page would freeze whatever mode the build machine had, and
// that machine is nobody's. There is a second reason since first-run exists: an
// unclaimed instance has nothing to do here and goes to /setup.
export const dynamic = "force-dynamic";

export default async function Page() {
  // Unclaimed, this screen is a dead end: there is no account to sign in with
  // and no way to create the first one from here. Whoever deploys this for the
  // first time lands on the install, not on a form that cannot work.
  if (!(await isClaimed())) redirect("/setup");

  // The mode itself, not a boolean derived from it: the screen now has three
  // shapes rather than two, and which one it takes is decided in
  // src/lib/login-layout.ts, where it can be tested. Hiding a field is courtesy
  // either way — authorizePassword refuses a password in "passkey" mode and
  // src/lib/auth.ts refuses an assertion in "password" mode, whatever is on the
  // screen.
  return (
    <Suspense fallback={null}>
      <LoginForm mode={authMode()} />
    </Suspense>
  );
}
