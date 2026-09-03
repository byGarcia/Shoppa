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

  // In "passkey" mode the password is not offered. authorizePassword refuses it
  // on the server anyway, so hiding the field is courtesy, not the defence.
  const passwordEnabled = authMode() !== "passkey";
  return (
    <Suspense fallback={null}>
      <LoginForm passwordEnabled={passwordEnabled} />
    </Suspense>
  );
}
