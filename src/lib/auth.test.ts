import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NextAuth no expone su configuración: `NextAuth(factory)` devuelve manejadores.
 * Se sustituye por un doble que guarda la fábrica, y así se puede llamar al
 * `authorize` del proveedor de credenciales, que es donde vive la decisión.
 */
const capturado = vi.hoisted(() => ({ factory: null as null | (() => Record<string, unknown>) }));

vi.mock("next-auth", () => ({
  default: (factory: () => Record<string, unknown>) => {
    capturado.factory = factory;
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
 * `Credentials(config)` de @auth/core devuelve un objeto con un `authorize`
 * de relleno que siempre da null y guarda la configuración real en `options`;
 * NextAuth las funde después. Leer el de arriba haría pasar cualquier prueba
 * que espere null, incluida la del rechazo, sin ejecutar una línea del código
 * que se quiere fijar.
 */
function authorize(): Authorize {
  const config = capturado.factory!();
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

describe("proveedor de credenciales", () => {
  it("con AUTH_MODE=password no atiende la ceremonia de passkey", async () => {
    process.env.AUTH_MODE = "password";
    const result = await authorize()(
      { email: "ana@example.com", webauthnAssertion: "{}" },
      undefined,
    );
    expect(result).toBeNull();
    expect(verifyWebAuthnAssertion).not.toHaveBeenCalled();
  });

  it("con AUTH_MODE=auto la passkey sigue su camino", async () => {
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

  it("la contraseña se resuelve en su rama y no toca la passkey", async () => {
    authorizePassword.mockResolvedValue({
      ok: true,
      user: { id: "u1", email: "ana@example.com", name: null, tokenVersion: 0 },
    });
    const result = await authorize()(
      { email: "ana@example.com", password: "una contraseña larga" },
      undefined,
    );
    expect(result).toEqual({ id: "u1", email: "ana@example.com", name: null, tokenVersion: 0 });
    expect(verifyWebAuthnAssertion).not.toHaveBeenCalled();
  });
});
