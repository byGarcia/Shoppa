import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NextAuth does not expose its config: `NextAuth(factory)` returns handlers.
 * It is replaced by a double that keeps the factory, so that the credentials
 * provider's `authorize` — where the decision lives — can be called directly.
 */
const captured = vi.hoisted(() => ({ factory: null as null | (() => Record<string, unknown>) }));

vi.mock("next-auth", () => ({
  default: (factory: () => Record<string, unknown>) => {
    captured.factory = factory;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));

const verifyWebAuthnAssertion = vi.fn();
vi.mock("@/server/webauthn", () => ({
  verifyWebAuthnAssertion: (...a: unknown[]) => verifyWebAuthnAssertion(...a),
  clientIPFromHeaders: () => null,
}));

const authorizePassword = vi.fn();
vi.mock("@/lib/auth-password", () => ({
  authorizePassword: (...a: unknown[]) => authorizePassword(...a),
}));

const securityLogCreate = vi.fn();
vi.mock("@/server/db", () => ({
  prisma: {
    securityLog: { create: (...a: unknown[]) => securityLogCreate(...a) },
    user: { findUnique: vi.fn() },
  },
}));

await import("./auth.ts");

type Authorize = (
  credentials: Record<string, unknown>,
  request: Request | undefined,
) => Promise<unknown>;

/**
 * `Credentials(config)` from @auth/core returns an object with a placeholder
 * `authorize` that always yields null, and keeps the real config in `options`;
 * NextAuth merges them later. Reading the top-level one would make any test
 * that expects null pass, the rejection one included, without running a single
 * line of the code being pinned down.
 */
function authorize(): Authorize {
  const config = captured.factory!();
  const providers = config.providers as { options: { authorize: Authorize } }[];
  return providers[0].options.authorize;
}

beforeEach(() => {
  verifyWebAuthnAssertion.mockReset();
  authorizePassword.mockReset();
  securityLogCreate.mockReset();
  securityLogCreate.mockResolvedValue({});
  process.env.APP_ORIGIN = "https://a.example";
  process.env.AUTH_MODE = "auto";
});

describe("credentials provider", () => {
  it("with AUTH_MODE=password it does not serve the passkey ceremony", async () => {
    process.env.AUTH_MODE = "password";
    const result = await authorize()(
      { email: "ana@example.com", webauthnAssertion: "{}" },
      undefined,
    );
    expect(result).toBeNull();
    expect(verifyWebAuthnAssertion).not.toHaveBeenCalled();
  });

  it("with AUTH_MODE=auto the passkey carries on its way", async () => {
    verifyWebAuthnAssertion.mockResolvedValue({
      ok: true,
      user: { id: "u1", email: "ana@example.com", name: null, tokenVersion: 0 },
    });
    const result = await authorize()(
      { email: "ana@example.com", webauthnAssertion: "{}" },
      undefined,
    );
    expect(result).toEqual({ id: "u1", email: "ana@example.com", name: null, tokenVersion: 0 });
    expect(verifyWebAuthnAssertion).toHaveBeenCalledOnce();
  });

  it("the password is resolved in its own branch and does not touch the passkey", async () => {
    authorizePassword.mockResolvedValue({
      ok: true,
      user: { id: "u1", email: "ana@example.com", name: null, tokenVersion: 0 },
    });
    const result = await authorize()(
      { email: "ana@example.com", password: "a long enough password" },
      undefined,
    );
    expect(result).toEqual({ id: "u1", email: "ana@example.com", name: null, tokenVersion: 0 });
    expect(verifyWebAuthnAssertion).not.toHaveBeenCalled();
  });
});
