import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyRegistrationResponse = vi.fn();
const generateRegistrationOptions = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
  generateRegistrationOptions: (...args: unknown[]) => generateRegistrationOptions(...args),
}));

// readChallengeCookie llama a cookies() de next/headers, que fuera de una
// petición real lanza. Lo que se prueba aquí es la autoridad y la transacción,
// no la cookie —que tiene sus propias pruebas en challenge-cookie.test.ts.
const challenge = vi.fn();
const cookiesEscritas: Array<{ scope: string; userId?: string; reauthenticated?: boolean }> = [];
const cookiesBorradas: number[] = [];
vi.mock("../challenge-cookie", () => ({
  readChallengeCookie: () => challenge(),
  clearChallengeCookieOn: () => {
    cookiesBorradas.push(1);
  },
  attachChallengeCookie: async (
    _res: unknown,
    _challenge: string,
    scope: string,
    userId?: string,
    reauthenticated?: boolean,
  ) => {
    cookiesEscritas.push({ scope, userId, reauthenticated });
  },
}));

// La prueba de presencia usa el verificador de aserciones de Task 3, que lee
// una cookie real; aquí sólo interesa que reauthenticate exija la correcta.
const verificaAsercion = vi.fn();
vi.mock("../credentials-authorize", () => ({
  verifyWebAuthnAssertion: (...args: unknown[]) => verificaAsercion(...args),
}));

const { prisma } = await import("@/server/db");
const { hashPassword } = await import("@/lib/password");
const { makeRegisterOptionsHandler } = await import("./register-options.ts");
const { makeRegisterVerifyHandler } = await import("./register-verify.ts");
const { setupToken } = await import("@/server/setup");
const { createInvitation, hashInvitationToken } = await import("@/server/invitations");
const { resetThrottleForTests, MAX_FAILURES } = await import("@/lib/login-throttle");
const { passkeyAccountStateFor } = await import("./reauthenticate.ts");

const ORIGINAL = { ...process.env };

const ApiResponse = {
  success: <T,>(data: T) => NextResponse.json({ ok: true, data }, { status: 200 }),
  unauthorized: () => NextResponse.json({ error: "No autorizado" }, { status: 401 }),
  badRequest: (message = "Solicitud inválida") => NextResponse.json({ error: message }, { status: 400 }),
};
const handleApiError = (error: unknown) =>
  NextResponse.json({ error: String(error) }, { status: 500 });

function peticion(body: unknown): NextRequest {
  return new NextRequest("https://shopping.example.com/api/auth/webauthn/register?step=verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function deps(session: { user: { id: string; email: string } } | null) {
  return { ApiResponse, handleApiError, getOptionalAuthSession: async () => session };
}

let userId: string;

beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    APP_ORIGIN: "https://shopping.example.com",
    AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
    AUTH_MODE: "auto",
  };
  vi.clearAllMocks();
  resetThrottleForTests();
  cookiesEscritas.length = 0;
  cookiesBorradas.length = 0;
  await prisma.securityLog.deleteMany();
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
  await prisma.instanceSetup.upsert({
    where: { id: "singleton" },
    update: { claimedAt: new Date() },
    create: { id: "singleton", claimedAt: new Date() },
  });
  const user = await prisma.user.create({
    data: { email: "ana@example.com", passwordHash: await hashPassword("una contraseña larga") },
    select: { id: true },
  });
  userId = user.id;

  // Con la prueba de identidad ya dada en el paso de opciones: es lo que
  // register-verify exige, y viaja dentro del JWT firmado.
  challenge.mockResolvedValue({
    challenge: "reto",
    scope: "register",
    userId,
    reauthenticated: true,
  });
  verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: "credencial-nueva",
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ["internal"],
      },
    },
  });
  generateRegistrationOptions.mockResolvedValue({ challenge: "reto" });
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

const attestation = JSON.stringify({ id: "credencial-nueva" });

describe("alta de passkey autorizada por la sesión", () => {
  it("crea la credencial y borra la contraseña en la misma transacción", async () => {
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count({ where: { userId } })).toBe(1);
  });

  it("guarda la clave pública en base64url, que es como la lee el verificador", async () => {
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    await handler(peticion({ attestation }));
    const credencial = await prisma.webAuthnCredential.findFirstOrThrow();
    expect(Buffer.from(credencial.publicKey, "base64url")).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it("sin sesión, sin token y sin invitación no registra nada", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });

  it("con sesión y token de instalación a la vez se rechaza, no se elige uno", async () => {
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(peticion({ attestation, setupToken: setupToken() }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("una invitación que no existe se rechaza, no cae en otra rama", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(peticion({ attestation, invitationToken: "lo-que-sea" }));
    expect(res.status).toBe(401);
  });

  it("con AUTH_MODE=password no se registra: sería una llave que no abre y borraría la que abre", async () => {
    process.env.AUTH_MODE = "password";
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(401);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });

  it("un reto emitido para otra cuenta no sirve para colgarle una credencial", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "register",
      userId: "otra-cuenta",
      reauthenticated: true,
    });
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("un reto de login no vale para registrar", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "login",
      userId,
      reauthenticated: true,
    });
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("si la attestation no verifica no se toca ni la credencial ni la contraseña", async () => {
    verifyRegistrationResponse.mockResolvedValue({ verified: false });
    const handler = makeRegisterVerifyHandler(deps({ user: { id: userId, email: "ana@example.com" } }));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });
});

// Una sesión sola no basta para esto: registrar una passkey borra la contraseña,
// no hay ninguna ruta en esta versión que borre una credencial ni que vuelva a
// poner contraseña, y la única salida es una consola en el servidor. Un móvil
// prestado con su JWT de 30 días no puede bastar para eso.
describe("volver a demostrar quién eres antes de registrar", () => {
  const sesion = () => ({ user: { id: userId, email: "ana@example.com" } });

  it("sin prueba ninguna, el paso de opciones no emite reto", async () => {
    const handler = makeRegisterOptionsHandler(deps(sesion()));
    const res = await handler(peticion({}));
    expect(res.status).toBe(400);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
    expect(cookiesEscritas).toHaveLength(0);
  });

  it("con la contraseña equivocada tampoco", async () => {
    const handler = makeRegisterOptionsHandler(deps(sesion()));
    const res = await handler(peticion({ currentPassword: "no es la suya" }));
    expect(res.status).toBe(400);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("con la contraseña correcta emite el reto marcado como confirmado", async () => {
    const handler = makeRegisterOptionsHandler(deps(sesion()));
    const res = await handler(peticion({ currentPassword: "una contraseña larga" }));
    expect(res.status).toBe(200);
    expect(cookiesEscritas).toEqual([
      { scope: "register", userId, reauthenticated: true },
    ]);
  });

  it("una cuenta sólo con passkey confirma con una aserción de presencia", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-que-ya-tenia",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
    verificaAsercion.mockResolvedValue({ ok: true, user: { id: userId } });

    const handler = makeRegisterOptionsHandler(deps(sesion()));
    const res = await handler(peticion({ presenceAssertion: JSON.stringify({ id: "la-que-ya-tenia" }) }));
    expect(res.status).toBe(200);
    // "presence", nunca "login": un reto de entrada no puede valer como prueba
    // para un cambio irreversible.
    expect(verificaAsercion).toHaveBeenCalledWith(
      "ana@example.com",
      expect.any(String),
      { expectedScope: "presence" },
    );
    expect(cookiesEscritas[0].reauthenticated).toBe(true);
  });

  it("una aserción que pertenece a otra cuenta no confirma ésta", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-que-ya-tenia",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
    verificaAsercion.mockResolvedValue({ ok: true, user: { id: "otra-cuenta" } });

    const handler = makeRegisterOptionsHandler(deps(sesion()));
    const res = await handler(peticion({ presenceAssertion: "{}" }));
    expect(res.status).toBe(400);
  });

  // Sin esto, la confirmación sería una segunda puerta a la misma contraseña sin
  // ningún freno detrás: el cubo por IP del proxy —que ha habido que ensanchar a
  // doce para que una ceremonia de tres viajes se pueda reintentar— sería el
  // único tope.
  it("la contraseña de la confirmación pasa por el mismo freno que la entrada", async () => {
    const handler = makeRegisterOptionsHandler(deps(sesion()));
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await handler(peticion({ currentPassword: "no es la suya" }));
    }
    // Frenada: ni siquiera la correcta emite reto mientras dure la ventana.
    const res = await handler(peticion({ currentPassword: "una contraseña larga" }));
    expect(res.status).toBe(400);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("una aserción de presencia fallida no frena la entrada de la casa", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "la-que-ya-tenia",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
    verificaAsercion.mockResolvedValue({ ok: false, user: null, reason: "wa_verify_failed" });
    const handler = makeRegisterOptionsHandler(deps(sesion()));
    for (let i = 0; i < MAX_FAILURES + 2; i += 1) {
      await handler(peticion({ presenceAssertion: "{}" }));
    }
    // Contarlas le daría a cualquiera con una sesión la forma de dejar a la casa
    // sin entrar por contraseña, y una aserción no esconde ningún secreto que
    // adivinar.
    const { isThrottled } = await import("@/lib/login-throttle");
    expect(isThrottled("ana@example.com")).toBe(false);
  });

  it("un reto emitido sin confirmación no se puede gastar en el paso que escribe", async () => {
    challenge.mockResolvedValue({ challenge: "reto", scope: "register", userId });
    const handler = makeRegisterVerifyHandler(deps(sesion()));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.passwordHash).not.toBeNull();
  });

  it("el alta queda escrita en security_logs", async () => {
    const handler = makeRegisterVerifyHandler(deps(sesion()));
    await handler(peticion({ attestation }));
    const evento = await prisma.securityLog.findFirstOrThrow();
    expect(evento.eventType).toBe("PASSKEY_REGISTERED");
    expect(evento.userId).toBe(userId);
  });

  it("el reto se quema también cuando la petición falla", async () => {
    challenge.mockResolvedValue({ challenge: "reto", scope: "login", userId });
    const handler = makeRegisterVerifyHandler(deps(sesion()));
    await handler(peticion({ attestation }));
    // Un reto que sobrevive a su propio rechazo es uno que se puede reintentar.
    expect(cookiesBorradas.length).toBeGreaterThan(0);
  });

  it("re-registrar la misma passkey es un mensaje, no un 500", async () => {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "credencial-nueva",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Ya estaba",
      },
    });
    const handler = makeRegisterVerifyHandler(deps(sesion()));
    const res = await handler(peticion({ attestation }));
    expect(res.status).toBe(400);
  });
});

// La tarjeta de Ajustes no tenía a quién preguntar y decía lo mismo para todas
// las cuentas: que la contraseña dejaría de funcionar. Una cuenta migrada de la
// aplicación anterior no tiene contraseña, así que era falso de principio a fin.
// Estas dos cosas —si hay contraseña y cuántas passkeys hay— son lo único que
// necesita para contarlo bien, y salen de la misma fila que ya lee
// reauthenticate.
describe("lo que la tarjeta puede preguntar sobre su propia cuenta", () => {
  async function ponPasskey(credentialId: string) {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId,
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Antigua",
      },
    });
  }

  it("una cuenta con contraseña dice que la tiene y confirma con ella", async () => {
    expect(await passkeyAccountStateFor(userId)).toEqual({
      reauth: "password",
      hasPassword: true,
      passkeyCount: 0,
    });
  });

  it("una cuenta migrada —passkey y ninguna contraseña— dice que no la tiene", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await ponPasskey("la-que-ya-tenia");
    expect(await passkeyAccountStateFor(userId)).toEqual({
      reauth: "presence",
      hasPassword: false,
      passkeyCount: 1,
    });
  });

  it("cuenta las passkeys que ya hay, que es lo que decide si ésta es una más", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await ponPasskey("una");
    await ponPasskey("otra");
    const estado = await passkeyAccountStateFor(userId);
    expect(estado.passkeyCount).toBe(2);
    expect(estado.hasPassword).toBe(false);
  });

  it("ni contraseña ni passkey: no hay con qué confirmar", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    expect(await passkeyAccountStateFor(userId)).toEqual({
      reauth: null,
      hasPassword: false,
      passkeyCount: 0,
    });
  });

  it("una sesión de una cuenta que ya no existe no recibe nada distinto", async () => {
    expect(await passkeyAccountStateFor("no-existe")).toEqual({
      reauth: null,
      hasPassword: false,
      passkeyCount: 0,
    });
  });

  // La respuesta va tal cual al navegador (GET de la ruta de registro): tres
  // campos y ninguno más. Ni el hash, ni un trozo, ni su longitud.
  it("no lleva el hash ni ningún otro campo de la fila", async () => {
    const fila = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const estado = await passkeyAccountStateFor(userId);
    expect(Object.keys(estado).sort()).toEqual(["hasPassword", "passkeyCount", "reauth"]);
    const json = JSON.stringify(estado);
    expect(json).not.toContain(fila.passwordHash);
    // Ni un trozo: un prefijo del hash es tan publicable como el hash entero.
    expect(json).not.toContain(fila.passwordHash!.slice(0, 12));
    expect(json).not.toContain(fila.email);
  });

  // El contador es de la cuenta que pregunta y de nadie más.
  it("no cuenta las passkeys de otra cuenta", async () => {
    const otra = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    await prisma.webAuthnCredential.create({
      data: {
        userId: otra.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Suya",
      },
    });
    expect((await passkeyAccountStateFor(userId)).passkeyCount).toBe(0);
  });
});

describe("alta de passkey en el primer arranque", () => {
  beforeEach(async () => {
    await prisma.webAuthnCredential.deleteMany();
    await prisma.user.deleteMany();
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: null } });
    challenge.mockResolvedValue({ challenge: "reto", scope: "register", userId: undefined });
  });

  it("con el token bueno crea la cuenta sin hash de contraseña", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(peticion({ attestation, setupToken: setupToken(), email: "Ana@Example.com" }));
    expect(res.status).toBe(200);
    const user = await prisma.user.findFirstOrThrow();
    expect(user.email).toBe("ana@example.com");
    expect(user.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  // El token se comprueba en los dos extremos: una ceremonia son dos viajes, y
  // el que escribe en la base de datos es éste.
  it("el paso de verificación vuelve a comprobar el token, no se fía del primero", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(
      peticion({ attestation, setupToken: "no-es-el-token", email: "ana@example.com" }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it("emitir opciones con un token equivocado tampoco pasa de la puerta", async () => {
    const handler = makeRegisterOptionsHandler(deps(null));
    const res = await handler(peticion({ setupToken: "no-es-el-token", email: "ana@example.com" }));
    expect(res.status).toBe(401);
    expect(generateRegistrationOptions).not.toHaveBeenCalled();
  });

  it("con la instancia ya reclamada el token de instalación deja de valer", async () => {
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: new Date() } });
    const handler = makeRegisterOptionsHandler(deps(null));
    const res = await handler(peticion({ setupToken: setupToken(), email: "ana@example.com" }));
    expect(res.status).toBe(401);
  });

  it("un reto atado a una cuenta no sirve para reclamar la instancia", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "register",
      userId: "alguien",
      reauthenticated: true,
    });
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(peticion({ attestation, setupToken: setupToken(), email: "ana@example.com" }));
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });
});

// La tercera autoridad. Se resuelve igual que el token de instalación —se
// comprueba en los dos extremos y se GASTA sólo en el que escribe— porque una
// invitación es de un solo uso: canjearla en el paso que reparte retos la
// quemaría antes de que exista la cuenta, y quien la abrió se quedaría con el
// prompt del autenticador delante y nada detrás.
describe("alta de passkey por invitación", () => {
  let token: string;

  beforeEach(async () => {
    token = (await createInvitation(userId)).token;
    challenge.mockResolvedValue({ challenge: "reto", scope: "register", userId: undefined });
  });

  const invitada = { attestation, email: "Luis@Example.com" };

  it("con una invitación válida crea la cuenta sin hash de contraseña y la marca usada", async () => {
    const handler = makeRegisterVerifyHandler(deps(null));
    const res = await handler(peticion({ ...invitada, invitationToken: token }));
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "luis@example.com" } });
    expect(user.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count({ where: { userId: user.id } })).toBe(1);
    const invitacion = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
    });
    expect(invitacion.usedAt).not.toBeNull();
  });

  it("el paso de opciones emite el reto y NO gasta la invitación", async () => {
    const handler = makeRegisterOptionsHandler(deps(null));
    const res = await handler(peticion({ invitationToken: token, email: "luis@example.com" }));
    expect(res.status).toBe(200);
    expect(cookiesEscritas).toEqual([
      // Sin cuenta a la que atarlo y sin confirmación previa: la cuenta todavía
      // no existe, así que no hay nada que volver a demostrar.
      { scope: "register", userId: undefined, reauthenticated: false },
    ]);
    const invitacion = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
    });
    expect(invitacion.usedAt).toBeNull();
  });

  it("una invitación ya usada no pasa de la puerta en ninguno de los dos pasos", async () => {
    await makeRegisterVerifyHandler(deps(null))(peticion({ ...invitada, invitationToken: token }));
    const opciones = await makeRegisterOptionsHandler(deps(null))(
      peticion({ invitationToken: token, email: "eva@example.com" }),
    );
    expect(opciones.status).toBe(401);
    const verify = await makeRegisterVerifyHandler(deps(null))(
      peticion({ attestation, email: "eva@example.com", invitationToken: token }),
    );
    expect(verify.status).toBe(401);
    expect(await prisma.user.findUnique({ where: { email: "eva@example.com" } })).toBeNull();
  });

  it("una invitación caducada tampoco", async () => {
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await makeRegisterVerifyHandler(deps(null))(
      peticion({ ...invitada, invitationToken: token }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  // Quien decide es redeemInvitation, dentro de su transacción: el resolutor de
  // autoridad dijo que sí y aun así no se crea nada, porque la dirección ya
  // tiene cuenta. Y la invitación NO se gasta — la transacción entera se
  // deshace, así que quien la tiene puede reintentar con otro correo.
  it("un correo ya registrado se rechaza sin gastar la invitación", async () => {
    const res = await makeRegisterVerifyHandler(deps(null))(
      peticion({ attestation, email: "ana@example.com", invitationToken: token }),
    );
    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
    const invitacion = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
    });
    expect(invitacion.usedAt).toBeNull();
  });

  it("con sesión e invitación a la vez se rechaza, no se elige una", async () => {
    const handler = makeRegisterVerifyHandler(
      deps({ user: { id: userId, email: "ana@example.com" } }),
    );
    const res = await handler(peticion({ ...invitada, invitationToken: token }));
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  it("un reto atado a una cuenta no sirve para canjear una invitación", async () => {
    challenge.mockResolvedValue({
      challenge: "reto",
      scope: "register",
      userId: "alguien",
      reauthenticated: true,
    });
    const res = await makeRegisterVerifyHandler(deps(null))(
      peticion({ ...invitada, invitationToken: token }),
    );
    expect(res.status).toBe(401);
    expect(await prisma.user.count()).toBe(1);
  });

  it("una passkey ya registrada aquí no se cuenta como correo ocupado", async () => {
    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: "credencial-nueva",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Ya estaba",
      },
    });
    const res = await makeRegisterVerifyHandler(deps(null))(
      peticion({ ...invitada, invitationToken: token }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("passkey") });
    expect(await prisma.user.count()).toBe(1);
  });

  it("deja escrito quién entró por ese enlace", async () => {
    await makeRegisterVerifyHandler(deps(null))(peticion({ ...invitada, invitationToken: token }));
    const invitacion = await prisma.invitation.findUniqueOrThrow({
      where: { tokenHash: hashInvitationToken(token) },
      include: { redeemedBy: { select: { email: true } } },
    });
    expect(invitacion.redeemedBy?.email).toBe("luis@example.com");
  });

  it("el alta por invitación queda escrita en security_logs", async () => {
    await makeRegisterVerifyHandler(deps(null))(peticion({ ...invitada, invitationToken: token }));
    const evento = await prisma.securityLog.findFirstOrThrow();
    expect(evento.eventType).toBe("PASSKEY_REGISTERED");
    expect(evento.email).toBe("luis@example.com");
    expect(evento.details).toContain("invitation");
  });
});
