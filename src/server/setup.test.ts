import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "./db.ts";
import { claimInstance, isClaimed, setupToken } from "./setup.ts";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    AUTH_SECRET: "secreto-de-prueba-suficientemente-largo",
    SETUP_TOKEN: undefined,
  };
  await prisma.webAuthnCredential.deleteMany();
  await prisma.user.deleteMany();
  await prisma.instanceSetup.upsert({
    where: { id: "singleton" },
    update: { claimedAt: null },
    create: { id: "singleton" },
  });
});

// El defecto que este bloque fija no lo veía ninguna prueba unitaria: `let token`
// memoiza por INSTANCIA DE MÓDULO, y Next compila el bundle del middleware
// aparte de los de las rutas, así que el módulo se instancia más de una vez en
// un mismo proceso y cada copia sacaba su propio valor al azar. El arranque
// imprimía un token y /api/setup comprobaba otro: instancia inservible desde el
// primer minuto. Recargar el módulo es la forma de reproducir eso aquí.
describe("el token de instalación", () => {
  async function tokenDeUnaCopiaNueva(): Promise<string> {
    vi.resetModules();
    const modulo = await import("./setup.ts");
    return modulo.setupToken();
  }

  it("dos copias del módulo dan el mismo token: no se memoiza, se deriva", async () => {
    process.env.AUTH_SECRET = "secreto-de-prueba-suficientemente-largo";
    expect(await tokenDeUnaCopiaNueva()).toBe(await tokenDeUnaCopiaNueva());
  });

  it("cambia si cambia AUTH_SECRET, y no lo revela", async () => {
    process.env.AUTH_SECRET = "un-secreto";
    const a = await tokenDeUnaCopiaNueva();
    process.env.AUTH_SECRET = "otro-secreto";
    const b = await tokenDeUnaCopiaNueva();
    expect(a).not.toBe(b);
    expect(a).not.toContain("un-secreto");
  });

  it("SETUP_TOKEN explícito manda sobre la derivación", async () => {
    process.env.SETUP_TOKEN = "el-mio";
    expect(await tokenDeUnaCopiaNueva()).toBe("el-mio");
  });

  it("sin AUTH_SECRET y sin SETUP_TOKEN lanza nombrando la variable", async () => {
    delete process.env.AUTH_SECRET;
    delete process.env.SETUP_TOKEN;
    await expect(tokenDeUnaCopiaNueva()).rejects.toThrow(/AUTH_SECRET/);
  });
});

describe("reclamación de la instancia", () => {
  it("una instancia sin usuarios está sin reclamar", async () => {
    expect(await isClaimed()).toBe(false);
  });

  it("rechaza un token de instalación equivocado", async () => {
    const result = await claimInstance({
      token: "no-es-el-token",
      email: "ana@example.com",
      password: "una contraseña larga",
    });
    expect(result).toEqual({ ok: false, reason: "bad-token" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("crea el usuario y marca la reclamación", async () => {
    const result = await claimInstance({
      token: setupToken(),
      email: "ana@example.com",
      password: "una contraseña larga",
    });
    expect(result.ok).toBe(true);
    expect(await isClaimed()).toBe(true);
    expect(await prisma.user.count()).toBe(1);
  });

  it("de dos reclamaciones simultáneas sólo prospera una, y no queda medio usuario", async () => {
    const token = setupToken();
    const [a, b] = await Promise.all([
      claimInstance({ token, email: "ana@example.com", password: "una contraseña larga" }),
      claimInstance({ token, email: "luis@example.com", password: "otra contraseña larga" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.user.count()).toBe(1);
  });

  // El Promise.all de arriba depende de que las dos transacciones se solapen de
  // verdad, y no lo garantiza: el scrypt previo introduce jitter y la ventana de
  // la primera transacción es de un par de milisegundos. Esta prueba fuerza el
  // solapamiento — mantiene una transacción abierta con la fila bloqueada
  // mientras la reclamación real llega — y es la que demuestra la garantía:
  // el segundo se queda esperando el bloqueo y, al soltarse, su UPDATE
  // condicional casa cero filas. Un «contar y decidir» leería claimed_at NULL
  // desde la instantánea previa al commit y crearía el usuario igualmente.
  it("una reclamación que llega con la fila bloqueada por otra transacción no prospera", async () => {
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
        UPDATE instance_setup SET claimed_at = now()
        WHERE id = 'singleton' AND claimed_at IS NULL`;
      dentro();
      await bloqueada;
    });

    await yaBloqueada;
    const tardio = claimInstance({
      token: setupToken(),
      email: "luis@example.com",
      password: "otra contraseña larga",
    });
    // Tiempo de sobra para que el UPDATE del tardío llegue al bloqueo.
    await new Promise((resolve) => setTimeout(resolve, 200));
    liberar();
    await retenedor;

    expect(await tardio).toEqual({ ok: false, reason: "already-claimed" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("ya reclamada, no se vuelve a reclamar", async () => {
    const token = setupToken();
    await claimInstance({ token, email: "ana@example.com", password: "una contraseña larga" });
    const second = await claimInstance({
      token,
      email: "luis@example.com",
      password: "otra contraseña larga",
    });
    expect(second).toEqual({ ok: false, reason: "already-claimed" });
  });

  // El CHECK mantiene la fila de instance_setup única, no obligatoria: tras un
  // DELETE el UPDATE condicional casa cero filas en silencio. Cero filas es
  // «no obtuve la reclamación», nunca «la fila ya estaba y sigue ahí».
  it("sin la fila de instance_setup no se reclama nada ni se crea usuario", async () => {
    await prisma.instanceSetup.deleteMany();
    const result = await claimInstance({
      token: setupToken(),
      email: "ana@example.com",
      password: "una contraseña larga",
    });
    expect(result.ok).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });

  it("guarda el correo en minúsculas y sin espacios", async () => {
    const result = await claimInstance({
      token: setupToken(),
      email: "  Ana@Example.COM  ",
      password: "una contraseña larga",
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findFirst({ select: { email: true } });
    expect(user?.email).toBe("ana@example.com");
  });

  it("una reclamación con credencial no guarda hash de contraseña", async () => {
    const result = await claimInstance({
      token: setupToken(),
      email: "ana@example.com",
      password: "una contraseña larga",
      credential: {
        credentialId: "credencial-de-prueba",
        publicKey: "clave-publica",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Dispositivo de prueba",
      },
    });
    expect(result.ok).toBe(true);
    const user = await prisma.user.findFirst({ select: { passwordHash: true } });
    expect(user?.passwordHash).toBeNull();
    expect(await prisma.webAuthnCredential.count()).toBe(1);
  });

  // La migración rellena claimed_at sólo para los usuarios que hubiera cuando
  // corrió, y cualquier fila escrita en users fuera del camino de reclamación
  // —una restauración, un INSERT a mano— deja la marca sin tocar. En ese estado
  // —usuarios sí, marca no— la puerta «no está reclamada» mandaba a la casa
  // entera a /setup y le abría a un visitante una ventana de registro al lado
  // de las cuentas que ya existían.
  it("con usuarios y sin marca, la instancia cuenta como reclamada", async () => {
    await prisma.user.create({ data: { email: "importada@example.com" } });
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: null } });
    expect(await isClaimed()).toBe(true);
  });

  it("con usuarios y sin marca, un token bueno no crea una segunda cuenta", async () => {
    await prisma.user.create({ data: { email: "importada@example.com" } });
    await prisma.instanceSetup.update({ where: { id: "singleton" }, data: { claimedAt: null } });
    const result = await claimInstance({
      token: setupToken(),
      email: "intrusa@example.com",
      password: "una contraseña larga",
    });
    expect(result).toEqual({ ok: false, reason: "already-claimed" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("sin contraseña ni credencial no crea nada y deja la instancia sin reclamar", async () => {
    const result = await claimInstance({ token: setupToken(), email: "ana@example.com" });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(await isClaimed()).toBe(false);
    expect(await prisma.user.count()).toBe(0);
  });
});
