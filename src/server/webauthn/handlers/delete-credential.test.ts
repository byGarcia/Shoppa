import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// La sesión. api-utils la pide a `auth()` de NextAuth, que fuera de una
// petición real no existe: aquí se decide a mano, que es justo lo que la ruta
// tiene que respetar.
let sesion: { user: { id: string; email: string } } | null = null;
vi.mock("@/lib/auth", () => ({ auth: async () => sesion }));

// La prueba de presencia usa el verificador de aserciones, que lee la cookie de
// reto de una petición real. Aquí sólo interesa que la ruta EXIJA una prueba y
// que la ate a esta cuenta.
const verificaAsercion = vi.fn();
vi.mock("@/server/webauthn/credentials-authorize", () => ({
  verifyWebAuthnAssertion: (...args: unknown[]) => verificaAsercion(...args),
}));

const { prisma } = await import("@/server/db");
const { hashPassword } = await import("@/lib/password");
const { resetThrottleForTests, MAX_FAILURES } = await import("@/lib/login-throttle");
const { deleteOwnCredential } = await import("./delete-credential.ts");
const { passkeyAccountStateFor } = await import("./reauthenticate.ts");
const { DELETE } = await import("@/app/api/auth/webauthn/credentials/[id]/route.ts");

const ORIGINAL = { ...process.env };
const CONTRASENA = "una contraseña larga";

let userId: string;

async function ponPasskey(credentialId: string, deviceName = "iPhone"): Promise<string> {
  const fila = await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId,
      publicKey: "clave",
      counter: 0n,
      transports: ["internal"],
      deviceName,
    },
    select: { id: true },
  });
  return fila.id;
}

function peticion(body: unknown = {}): NextRequest {
  return new NextRequest("https://shopping.example.com/api/auth/webauthn/credentials/x", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

function borra(id: string, body: unknown = {}) {
  return DELETE(peticion(body), { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    APP_ORIGIN: "https://shopping.example.com",
    AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
    AUTH_MODE: "auto",
  };
  vi.clearAllMocks();
  resetThrottleForTests();
  await prisma.securityLog.deleteMany();
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
  const user = await prisma.user.create({
    data: { email: "ana@example.com", passwordHash: await hashPassword(CONTRASENA) },
    select: { id: true },
  });
  userId = user.id;
  sesion = { user: { id: userId, email: "ana@example.com" } };
});

afterEach(async () => {
  process.env = { ...ORIGINAL };
  sesion = null;
  await prisma.securityLog.deleteMany();
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
});

/**
 * Hasta ahora una credencial sólo podía añadirse. La passkey de un móvil
 * perdido seguía abriendo la instancia para siempre y ninguna pantalla la
 * retiraba; la única forma era `psql`.
 */
describe("la guarda que importa: nunca dejar una cuenta sin forma de entrar", () => {
  beforeEach(async () => {
    // Una cuenta migrada de la aplicación anterior: passkeys y ninguna
    // contraseña. Es la cuenta de todo el mundo que venía de antes.
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
  });

  it("con una sola passkey y sin contraseña, el servidor se niega", async () => {
    const id = await ponPasskey("la-unica");
    expect(await deleteOwnCredential(userId, id)).toEqual({
      ok: false,
      reason: "last-credential",
    });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("con dos, se puede quitar una", async () => {
    const primera = await ponPasskey("una", "iPhone");
    await ponPasskey("otra", "Mac");
    expect(await deleteOwnCredential(userId, primera)).toEqual({
      ok: true,
      deviceName: "iPhone",
      remaining: 1,
    });
    expect((await passkeyAccountStateFor(userId)).passkeys.map((p) => p.deviceName)).toEqual(["Mac"]);
  });

  it("pero la segunda ya no: se ha convertido en la única", async () => {
    const primera = await ponPasskey("una");
    const segunda = await ponPasskey("otra", "Mac");
    await deleteOwnCredential(userId, primera);
    expect(await deleteOwnCredential(userId, segunda)).toEqual({
      ok: false,
      reason: "last-credential",
    });
  });

  /**
   * El caso que decide dónde vive la guarda. Dos borrados a la vez, uno por
   * cada una de las dos últimas credenciales: cada uno lee «hay dos», cada uno
   * borra la suya y la cuenta se queda con cero. No hace falta un atacante —
   * dos móviles, una lista cada uno, un toque cada uno.
   *
   * Lo que lo impide es `SELECT … FOR UPDATE` sobre la fila de la cuenta,
   * tomado ANTES de contar: el segundo se queda esperando el cerrojo y, cuando
   * lee, el primero ya ha confirmado y sólo queda una.
   */
  it("dos borrados a la vez por las dos últimas: gana uno y la cuenta conserva una", async () => {
    const primera = await ponPasskey("una", "iPhone");
    const segunda = await ponPasskey("otra", "Mac");

    // El otro borrado, escrito a mano para poder pararlo a medias: toma el
    // cerrojo de la cuenta, quita SU credencial y se queda ahí sin confirmar.
    // Es lo que hace la función de verdad, con la ventana abierta a propósito.
    const elOtroBorrado = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT password_hash FROM users WHERE id = ${userId} FOR UPDATE`;
        await tx.webAuthnCredential.deleteMany({ where: { id: primera, userId } });
        await new Promise((listo) => setTimeout(listo, 400));
      },
      { timeout: 15_000 },
    );

    // Entra con la transacción de arriba a medio hacer. Sin el cerrojo lee «hay
    // dos» —el borrado del otro no está confirmado— y quita la suya: cero
    // credenciales y nadie puede entrar. Con él, espera, lee «queda una» y se
    // niega.
    const [, resultado] = await Promise.all([
      elOtroBorrado,
      (async () => {
        await new Promise((listo) => setTimeout(listo, 100));
        return deleteOwnCredential(userId, segunda);
      })(),
    ]);

    expect(resultado).toEqual({ ok: false, reason: "last-credential" });
    expect(await prisma.webAuthnCredential.count({ where: { userId } })).toBe(1);
  });

  it("con contraseña sí puede quitarse la única passkey: queda otra puerta", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(CONTRASENA) },
    });
    const id = await ponPasskey("la-unica");
    expect(await deleteOwnCredential(userId, id)).toMatchObject({ ok: true, remaining: 0 });
  });

  it("salvo con AUTH_MODE=passkey, donde esa contraseña no abre nada", async () => {
    // authorizePassword rechaza toda contraseña en ese modo, así que un hash
    // dejado por el rescate de consola no es una forma de entrar y no puede
    // autorizar quitar la última llave.
    process.env.AUTH_MODE = "passkey";
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(CONTRASENA) },
    });
    const id = await ponPasskey("la-unica");
    expect(await deleteOwnCredential(userId, id)).toEqual({
      ok: false,
      reason: "last-credential",
    });
  });
});

describe("de quién es la credencial que se nombra", () => {
  it("la de otra cuenta se rechaza igual que una que no existe", async () => {
    const otra = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    const suya = await prisma.webAuthnCredential.create({
      data: {
        userId: otra.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "El portátil de Luis",
      },
      select: { id: true },
    });

    const ajena = await deleteOwnCredential(userId, suya.id);
    const inventada = await deleteOwnCredential(userId, "no-existe-esta-fila");
    // La misma respuesta, palabra por palabra: la diferencia entre «no es tuya»
    // y «no existe» contestaría de quién es una fila a cualquiera con sesión.
    expect(ajena).toEqual(inventada);
    expect(ajena).toEqual({ ok: false, reason: "not-found" });
    expect(await prisma.webAuthnCredential.count({ where: { userId: otra.id } })).toBe(1);
  });

  it("una sesión de una cuenta que ya no existe tampoco borra nada", async () => {
    const id = await ponPasskey("la-mia");
    expect(await deleteOwnCredential("no-existe", id)).toEqual({ ok: false, reason: "not-found" });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("un id inventado no se contesta con «es tu última»: no es de esta cuenta", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await ponPasskey("la-unica");
    // La cuenta SÍ está en el caso de la última llave, y aun así la respuesta
    // habla del id que se nombró, no del estado de la cuenta.
    expect(await deleteOwnCredential(userId, "no-existe-esta-fila")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

/**
 * Borrar exige la misma prueba que añadir, y por la misma razón: un móvil
 * prestado con su JWT de 30 días no puede bastar para quitarle a su dueño la
 * llave con la que entra.
 */
describe("la ruta: volver a demostrar quién eres antes de borrar", () => {
  it("sin sesión no llega a mirar ninguna fila", async () => {
    const id = await ponPasskey("la-mia");
    sesion = null;
    const res = await borra(id, { currentPassword: CONTRASENA });
    expect(res.status).toBe(401);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("sin ninguna prueba, la sesión sola no basta", async () => {
    const id = await ponPasskey("la-mia");
    const res = await borra(id);
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("con la contraseña equivocada tampoco", async () => {
    const id = await ponPasskey("la-mia");
    const res = await borra(id, { currentPassword: "no es la suya" });
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("con la correcta, la retira", async () => {
    const id = await ponPasskey("la-mia");
    const res = await borra(id, { currentPassword: CONTRASENA });
    expect(res.status).toBe(200);
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it("la contraseña pasa por el mismo freno por cuenta que la entrada", async () => {
    const id = await ponPasskey("la-mia");
    for (let i = 0; i < MAX_FAILURES; i += 1) {
      await borra(id, { currentPassword: "no es la suya" });
    }
    // Frenada: ni la correcta borra nada mientras dure la ventana.
    const res = await borra(id, { currentPassword: CONTRASENA });
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("una cuenta sin contraseña confirma con una aserción de presencia", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    const id = await ponPasskey("la-que-se-va");
    await ponPasskey("la-que-se-queda", "Mac");
    verificaAsercion.mockResolvedValue({ ok: true, user: { id: userId } });

    const res = await borra(id, { presenceAssertion: JSON.stringify({ id: "la-que-se-queda" }) });
    expect(res.status).toBe(200);
    // "presence", nunca "login": un reto de entrada no vale como prueba para un
    // cambio que no se deshace.
    expect(verificaAsercion).toHaveBeenCalledWith("ana@example.com", expect.any(String), {
      expectedScope: "presence",
    });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("una aserción que pertenece a otra cuenta no confirma ésta", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    const id = await ponPasskey("la-que-se-va");
    await ponPasskey("otra", "Mac");
    verificaAsercion.mockResolvedValue({ ok: true, user: { id: "otra-cuenta" } });

    const res = await borra(id, { presenceAssertion: "{}" });
    expect(res.status).toBe(400);
    expect(await prisma.webAuthnCredential.count()).toBe(2);
  });
});

describe("lo que contesta la ruta", () => {
  it("la credencial de otra cuenta y una que no existe reciben el mismo 404", async () => {
    const otra = await prisma.user.create({
      data: { email: "luis@example.com", passwordHash: null },
      select: { id: true },
    });
    const suya = await prisma.webAuthnCredential.create({
      data: {
        userId: otra.id,
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Suya",
      },
      select: { id: true },
    });

    const ajena = await borra(suya.id, { currentPassword: CONTRASENA });
    const inventada = await borra("no-existe-esta-fila", { currentPassword: CONTRASENA });
    expect(ajena.status).toBe(404);
    expect(inventada.status).toBe(404);
    expect(await ajena.json()).toEqual(await inventada.json());
  });

  it("la última llave es un 409 con su propio código, no un error genérico", async () => {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    const id = await ponPasskey("la-unica");
    verificaAsercion.mockResolvedValue({ ok: true, user: { id: userId } });

    const res = await borra(id, { presenceAssertion: "{}" });
    expect(res.status).toBe(409);
    // El código es lo que deja a la tarjeta explicarlo en vez de limitarse a
    // enseñar «no se ha podido borrar».
    expect(await res.json()).toMatchObject({ code: "LAST_CREDENTIAL" });
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  it("el borrado queda escrito en security_logs", async () => {
    const id = await ponPasskey("la-mia", "iPhone");
    await borra(id, { currentPassword: CONTRASENA });

    const evento = await prisma.securityLog.findFirstOrThrow();
    // El enum tenía PASSKEY_DELETED desde el principio y nadie lo había escrito
    // nunca: no había ninguna ruta que borrara.
    expect(evento.eventType).toBe("PASSKEY_DELETED");
    expect(evento.userId).toBe(userId);
    expect(evento.success).toBe(true);
    expect(evento.details).toContain("iPhone");
  });

  it("un rechazo no escribe ninguna fila de borrado", async () => {
    const id = await ponPasskey("la-mia");
    await borra(id, { currentPassword: "no es la suya" });
    expect(await prisma.securityLog.count({ where: { eventType: "PASSKEY_DELETED" } })).toBe(0);
  });
});
