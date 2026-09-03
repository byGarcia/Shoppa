import { beforeEach, describe, expect, it, vi } from "vitest";

// Cuenta las derivaciones sin sustituirlas: el resto del fichero necesita que
// scrypt siga siendo scrypt de verdad.
const derivaciones = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/password", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/password")>();
  return {
    ...real,
    hashPassword: async (plano: string) => {
      derivaciones.n += 1;
      return real.hashPassword(plano);
    },
  };
});

import { prisma } from "./db.ts";
import {
  createInvitation,
  hashInvitationToken,
  inspectInvitation,
  listInvitations,
  redeemInvitation,
  revokeInvitation,
} from "./invitations.ts";

let inviterId: string;

beforeEach(async () => {
  await prisma.webAuthnCredential.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.user.deleteMany();
  inviterId = (await prisma.user.create({ data: { email: "ana@example.com" } })).id;
  derivaciones.n = 0;
});

/** Los usuarios que hay además de quien invita. */
async function usuariosNuevos(): Promise<number> {
  return (await prisma.user.count()) - 1;
}

describe("invitaciones", () => {
  it("guarda el hash y no el token", async () => {
    const { token } = await createInvitation(inviterId);
    const stored = await prisma.invitation.findFirst();
    expect(stored?.tokenHash).not.toBe(token);
    // Y el hash es el que se busca al canjear: guardar «algo distinto» no es
    // guardar el hash. Sin esto, un digest de otra cosa pasaría igual.
    expect(stored?.tokenHash).toBe(hashInvitationToken(token));
  });

  it("se canjea una vez y sólo una", async () => {
    const { token } = await createInvitation(inviterId);
    const first = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(first.ok).toBe(true);
    const second = await redeemInvitation({
      token,
      email: "otro@example.com",
      password: "otra contraseña larga",
    });
    expect(second).toEqual({ ok: false, reason: "used" });
    expect(await usuariosNuevos()).toBe(1);
  });

  it("caducada no vale", async () => {
    const { token } = await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(
      await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  // La caducidad viaja DENTRO del UPDATE condicional, así que una invitación
  // caducada no casa ninguna fila y no se marca usada. Si se comprobase antes y
  // se marcase después, «caducada» pisaría a «usada» y el motivo que ve quien
  // abre el enlace dependería del orden en que se mirasen las dos cosas.
  it("una caducada no se gasta: sigue sin usar", async () => {
    const { token } = await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" });
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
  });

  it("un token inventado no crea usuario", async () => {
    const before = await prisma.user.count();
    const result = await redeemInvitation({
      token: "inventado",
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(result).toEqual({ ok: false, reason: "unknown" });
    expect(await prisma.user.count()).toBe(before);
  });

  // El reloj se toma a AMBOS lados de la llamada, no sólo antes. Con una sola
  // muestra previa, el margen que tarda el insert se suma al plazo y la
  // comparación con «72 exactas» salía 72.00000027777777: roja en la suite
  // entera y verde en solitario. Ha interrumpido dos tareas que no tenían nada
  // que ver con invitaciones.
  //
  // Encerrarlo entre las dos muestras no afloja lo que comprueba, lo aprieta:
  // el plazo se emite en algún instante entre `antes` y `despues`, así que
  // medido desde el tardío no puede pasar de 72 h y medido desde el temprano no
  // puede quedarse corto. Las dos cotas a la vez fijan la constante — con 71 h
  // falla la de abajo y con 73 h la de arriba— y ninguna depende de lo que se
  // haya tardado. El 72 va escrito aquí a mano: comparar contra
  // INVITATION_TTL_MS sería preguntarle a la constante por sí misma.
  it("caduca a 72 horas", async () => {
    const HORA = 3_600_000;
    const antes = Date.now();
    const { expiresAt } = await createInvitation(inviterId);
    const despues = Date.now();
    expect(expiresAt.getTime() - despues).toBeLessThanOrEqual(72 * HORA);
    expect(expiresAt.getTime() - antes).toBeGreaterThanOrEqual(72 * HORA);
  });

  it("guarda el correo en minúsculas y sin espacios", async () => {
    const { token } = await createInvitation(inviterId);
    const result = await redeemInvitation({
      token,
      email: "  Luis@Example.COM  ",
      password: "una contraseña larga",
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findFirst({ where: { email: "luis@example.com" } });
    expect(user).not.toBeNull();
  });

  it("sin contraseña ni credencial no crea nada y deja la invitación sin usar", async () => {
    const { token } = await createInvitation(inviterId);
    expect(await redeemInvitation({ token, email: "luis@example.com" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await usuariosNuevos()).toBe(0);
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
  });

  // El índice único sobre lower(email) salta DENTRO de la transacción, así que
  // se lleva por delante el UPDATE: la invitación no se gasta en una cuenta que
  // no ha llegado a existir y quien la tiene puede reintentar con la dirección
  // que quería.
  it("un correo ya registrado no gasta la invitación", async () => {
    const { token } = await createInvitation(inviterId);
    const choque = await redeemInvitation({
      token,
      email: "ANA@example.com",
      password: "una contraseña larga",
    });
    expect(choque).toEqual({ ok: false, reason: "email-taken" });
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();

    const buena = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(buena.ok).toBe(true);
  });

  it("una invitación con credencial no guarda hash de contraseña", async () => {
    const { token } = await createInvitation(inviterId);
    const result = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
      credential: {
        credentialId: "credencial-de-invitado",
        publicKey: "clave-publica",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Dispositivo de prueba",
      },
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findUnique({
      where: { email: "luis@example.com" },
      select: { passwordHash: true },
    });
    expect(user?.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  // La invitación es de la instancia, no de quien la mandó: si el enlace se
  // rompiera al borrar a quien invita, la explicación tendría que estar en algún
  // sitio. Está en el esquema —ON DELETE CASCADE— y dice lo contrario: se borra.
  it("si se borra quien invitó, su invitación desaparece", async () => {
    const { token } = await createInvitation(inviterId);
    await prisma.user.delete({ where: { id: inviterId } });
    expect(await prisma.invitation.count()).toBe(0);
    expect(
      await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      }),
    ).toEqual({ ok: false, reason: "unknown" });
  });

  it("mirar una invitación no la gasta", async () => {
    const { token } = await createInvitation(inviterId);
    expect(await inspectInvitation(token)).toEqual({ ok: true });
    expect(await inspectInvitation(token)).toEqual({ ok: true });
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
    expect(
      (await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      })).ok,
    ).toBe(true);
    expect(await inspectInvitation(token)).toEqual({ ok: false, reason: "used" });
    expect(await inspectInvitation("inventado")).toEqual({ ok: false, reason: "unknown" });
  });

  it("de dos canjes simultáneos sólo prospera uno", async () => {
    const { token } = await createInvitation(inviterId);
    const [a, b] = await Promise.all([
      redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" }),
      redeemInvitation({ token, email: "eva@example.com", password: "otra contraseña larga" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await usuariosNuevos()).toBe(1);
  });

  // El Promise.all de arriba NO discrimina: la revisión de la tarea 9 demostró
  // que un «leer y luego escribir» lo pasa igual, porque las dos transacciones
  // tienen que solaparse de verdad y la ventana es de un par de milisegundos —
  // con el scrypt previo metiendo jitter encima. Ésta fuerza el solapamiento:
  // mantiene la fila bloqueada en una transacción sin confirmar mientras llega
  // el canje real. El UPDATE del canje se queda esperando el bloqueo y, al
  // soltarse, casa cero filas. Un «leer y decidir» habría leído used_at NULL de
  // la instantánea anterior al commit y habría creado la cuenta igualmente.
  it("un canje que llega con la fila bloqueada por otra transacción no prospera", async () => {
    const { token } = await createInvitation(inviterId);
    const tokenHash = hashInvitationToken(token);

    let liberar: () => void = () => {};
    const bloqueada = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    let dentro: () => void = () => {};
    const yaBloqueada = new Promise<void>((resolve) => {
      dentro = resolve;
    });

    const retenedor = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
      dentro();
      await bloqueada;
    });

    await yaBloqueada;
    const tardio = redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    // Tiempo de sobra para que el UPDATE del tardío llegue al bloqueo.
    await new Promise((resolve) => setTimeout(resolve, 200));
    liberar();
    await retenedor;

    expect(await tardio).toEqual({ ok: false, reason: "used" });
    expect(await usuariosNuevos()).toBe(0);
  });
});

// El canje es público (/api/invitations/redeem no pide sesión: quien llega
// invitado no tiene ninguna), así que lo que cuesta atenderlo lo elige un
// desconocido. scrypt con N=65536 son ~64 MiB y ~100 ms por llamada, y el
// threadpool de libuv tiene cuatro plazas: derivar antes de mirar el token es
// regalarle a cualquiera la memoria de una máquina que puede ser una Raspberry
// Pi. claimInstance ya lo hace en este orden —comprueba el token, deriva
// después— y aquí faltaba.
describe("lo que cuesta un token inventado", () => {
  it("un token que no existe no deriva ninguna clave", async () => {
    const result = await redeemInvitation({
      token: "inventado",
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(result).toEqual({ ok: false, reason: "unknown" });
    expect(derivaciones.n).toBe(0);
  });

  it("una caducada y una usada tampoco", async () => {
    const caducada = await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await redeemInvitation({
      token: caducada.token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });

    const usada = await createInvitation(inviterId);
    await redeemInvitation({
      token: usada.token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    const derivadasHastaAqui = derivaciones.n;
    await redeemInvitation({
      token: usada.token,
      email: "eva@example.com",
      password: "otra contraseña larga",
    });
    expect(derivaciones.n).toBe(derivadasHastaAqui);
  });

  it("una invitación buena sí deriva: la lectura previa no sustituye a nada", async () => {
    const { token } = await createInvitation(inviterId);
    await redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" });
    expect(derivaciones.n).toBe(1);
  });

  // La lectura previa es sólo coste: quien decide sigue siendo el UPDATE
  // condicional. Si adelantar la comprobación hubiese movido la decisión, esta
  // prueba —la del bloqueo, la única que discrimina— se habría puesto roja.
  it("y sigue sin decidir nada: con la fila bloqueada el canje no prospera", async () => {
    const { token } = await createInvitation(inviterId);
    const tokenHash = hashInvitationToken(token);

    let liberar: () => void = () => {};
    const bloqueada = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    let dentro: () => void = () => {};
    const yaBloqueada = new Promise<void>((resolve) => {
      dentro = resolve;
    });

    const retenedor = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
      dentro();
      await bloqueada;
    });

    await yaBloqueada;
    // La lectura previa ve la invitación todavía sin usar —el que la bloquea no
    // ha confirmado— así que el canje pasa de largo y llega al UPDATE.
    const tardio = redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    liberar();
    await retenedor;

    expect(await tardio).toEqual({ ok: false, reason: "used" });
    expect(await usuariosNuevos()).toBe(0);
  });
});

// Las dos escrituras de la transacción tienen un índice único detrás. Contar
// cualquier P2002 como «ese correo ya está cogido» le diría a quien llega
// invitado algo falso sobre la cuenta de otro.
describe("de qué índice único viene el rechazo", () => {
  it("una passkey ya registrada no se cuenta como correo ocupado", async () => {
    await prisma.webAuthnCredential.create({
      data: {
        userId: inviterId,
        credentialId: "ya-registrada",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "La de Ana",
      },
    });
    const { token } = await createInvitation(inviterId);
    const result = await redeemInvitation({
      token,
      email: "luis@example.com",
      credential: {
        credentialId: "ya-registrada",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "La de Luis",
      },
    });
    expect(result).toEqual({ ok: false, reason: "credential-taken" });
    // Y como salta dentro de la transacción, la invitación tampoco se gasta.
    expect((await prisma.invitation.findFirst())?.usedAt).toBeNull();
    expect(await usuariosNuevos()).toBe(0);
  });
});

// Cerrar la sesión de un móvil perdido —subir token_version— no toca las
// invitaciones que esa sesión creó: quedaban vivas hasta 72 horas, sin forma de
// verlas ni de retirarlas.
describe("ver y retirar invitaciones", () => {
  it("registra quién entró por cada enlace", async () => {
    const { token } = await createInvitation(inviterId);
    const canje = await redeemInvitation({
      token,
      email: "luis@example.com",
      password: "una contraseña larga",
    });
    expect(canje.ok).toBe(true);

    const [fila] = await listInvitations();
    expect(fila.state).toBe("redeemed");
    expect(fila.createdByEmail).toBe("ana@example.com");
    expect(fila.redeemedByEmail).toBe("luis@example.com");
  });

  it("también cuando la cuenta se creó con passkey", async () => {
    const { token } = await createInvitation(inviterId);
    await redeemInvitation({
      token,
      email: "luis@example.com",
      credential: {
        credentialId: "la-de-luis",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "un teléfono",
      },
    });
    const [fila] = await listInvitations();
    expect(fila.redeemedByEmail).toBe("luis@example.com");
  });

  it("la lista no lleva el token ni su hash a ninguna parte", async () => {
    await createInvitation(inviterId);
    const [fila] = await listInvitations();
    expect(Object.keys(fila)).not.toContain("tokenHash");
    expect(JSON.stringify(fila)).not.toContain("tokenHash");
  });

  it("revocar mata el enlace: quien lo tenga ya no puede canjearlo", async () => {
    const { token } = await createInvitation(inviterId);
    const [fila] = await listInvitations();
    expect(fila.state).toBe("pending");

    expect(await revokeInvitation(fila.id)).toBe(true);
    expect((await listInvitations())[0].state).toBe("revoked");
    expect(
      await redeemInvitation({
        token,
        email: "luis@example.com",
        password: "una contraseña larga",
      }),
    ).toEqual({ ok: false, reason: "used" });
    expect(await usuariosNuevos()).toBe(0);
  });

  it("revocar una ya usada no prospera ni borra quién entró", async () => {
    const { token } = await createInvitation(inviterId);
    await redeemInvitation({ token, email: "luis@example.com", password: "una contraseña larga" });
    const [fila] = await listInvitations();

    expect(await revokeInvitation(fila.id)).toBe(false);
    const despues = (await listInvitations())[0];
    expect(despues.state).toBe("redeemed");
    expect(despues.redeemedByEmail).toBe("luis@example.com");
    expect(despues.usedAt).toEqual(fila.usedAt);
  });

  it("revocar algo que no existe no prospera", async () => {
    expect(await revokeInvitation("no-es-un-id")).toBe(false);
  });

  it("una caducada sin usar se ve como caducada, no como revocada", async () => {
    await createInvitation(inviterId);
    await prisma.invitation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await listInvitations())[0].state).toBe("expired");
  });

  // Revocar y canjear escriben la MISMA columna con la misma UPDATE condicional,
  // así que las decide Postgres y no el orden en que dos manejadores leyeron. Si
  // la revocación viviera en una columna aparte, esto devolvería true: habría
  // «revocado» una invitación que en ese mismo instante estaba creando una
  // cuenta, y la casa tendría un miembro que su registro da por no admitido.
  it("una revocación que llega con el canje en vuelo no prospera", async () => {
    const { token } = await createInvitation(inviterId);
    const tokenHash = hashInvitationToken(token);
    const [fila] = await listInvitations();

    let liberar: () => void = () => {};
    const bloqueada = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    let dentro: () => void = () => {};
    const yaBloqueada = new Promise<void>((resolve) => {
      dentro = resolve;
    });

    // El canje, retenido justo después de tomar la fila.
    const canje = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL`;
      dentro();
      await bloqueada;
    });

    await yaBloqueada;
    const revocacion = revokeInvitation(fila.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    liberar();
    await canje;

    expect(await revocacion).toBe(false);
  });
});
