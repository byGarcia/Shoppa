export { verifyWebAuthnAssertion } from "./credentials-authorize";
export { clientIPFromHeaders } from "./client-ip";
export { makeLoginOptionsHandler } from "./handlers/login-options";
export { makeRegisterOptionsHandler } from "./handlers/register-options";
export { makeRegisterPresenceHandler } from "./handlers/register-presence";
export { makeRegisterVerifyHandler } from "./handlers/register-verify";
export type { WebAuthnHandlerDeps } from "./handlers/types";
export { WEBAUTHN_CONFIG } from "./config";
export { attachChallengeCookie, clearChallengeCookieOn } from "./challenge-cookie";
