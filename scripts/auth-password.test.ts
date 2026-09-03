import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { authorizePassword } from "../src/lib/auth-password.ts";
import { normalizeEmail as normalizeEmailApp } from "../src/lib/email.ts";
import { MIN_PASSWORD_LENGTH, verifyPassword } from "../src/lib/password.ts";
import { prisma } from "../src/server/db.ts";
import { findAccount, normalizeEmail, readLineFrom, resetPassword } from "./auth-password.mjs";
import { getClient } from "./lib/db.mjs";

const ETX = String.fromCharCode(3); // Ctrl-C
const EOT = String.fromCharCode(4); // Ctrl-D
const ESC = String.fromCharCode(27); // Inicio de las teclas de flecha
const DEL = String.fromCharCode(127); // Backspace

const CORREO = "rescate-tarea14@example.com";
const LARGA = "una contraseña larga";

let client: Client;

beforeAll(async () => {
  client = await getClient();
});

afterAll(async () => {
  await client.end();
});

afterEach(async () => {
  // `insensitive`, because one of the cases below stores the address in mixed
  // case on purpose and `contains` is case-sensitive in Postgres: without this
  // that row survives the suite and stays in the development database.
  await prisma.securityLog.deleteMany({
    where: { email: { contains: "rescate-tarea14", mode: "insensitive" } },
  });
  await prisma.user.deleteMany({
    where: { email: { contains: "rescate-tarea14", mode: "insensitive" } },
  });
});

async function crearUsuario(email = CORREO, passwordHash: string | null = null) {
  return prisma.user.create({ data: { email, passwordHash, tokenVersion: 3 } });
}

describe("normalizeEmail del rescate", () => {
  // The script cannot import src/lib/email.ts — `src/lib` is not in the runner
  // image — so the rule exists twice. This is what stops the copies drifting:
  // if one of them starts stripping dots or handling +tags, the rescue and the
  // login would look up different rows and only one of them would say so.
  it("contesta exactamente lo mismo que el de la aplicación", () => {
    const casos = [
      "ana@example.com",
      "Ana@Example.COM",
      "  ana@example.com  ",
      "\tANA@EXAMPLE.COM\n",
      "Ana.Garcia+compra@Example.com",
      "",
      "   ",
      "sin-arroba",
      "MAYÚSCULAS@example.com",
    ];
    for (const caso of casos) {
      expect(normalizeEmail(caso)).toBe(normalizeEmailApp(caso));
    }
  });
});

describe("readLineFrom", () => {
  it("espera mientras no haya llegado el salto de línea", () => {
    expect(readLineFrom("medio")).toEqual({ status: "incomplete", value: "medio", rest: "" });
  });

  it("corta en el salto de línea y devuelve el resto", () => {
    // La regresión que costó una ejecución entera: pegar la contraseña y su
    // repetición manda las dos en un solo trozo. Tirar lo que va detrás del
    // salto dejaba al segundo aviso sin nada que leer.
    expect(readLineFrom("clave\nrepetida\n")).toEqual({
      status: "line",
      value: "clave",
      rest: "repetida\n",
    });
  });

  it("trata CRLF como un único final de línea, no como una línea vacía detrás", () => {
    expect(readLineFrom("clave\r\notra")).toEqual({
      status: "line",
      value: "clave",
      rest: "otra",
    });
  });

  it("aplica el borrado", () => {
    expect(readLineFrom(`clavv${DEL}e\n`).value).toBe("clave");
    expect(readLineFrom(`${DEL}${DEL}clave\n`).value).toBe("clave");
  });

  it("no deja que una tecla de flecha entre en la contraseña", () => {
    // Tirar sólo el ESC —lo que hace una regla de «ignora los caracteres de
    // control»— dejaría «[C» dentro de la contraseña, invisible para quien la
    // teclea y fatal para quien intente entrar con ella después.
    expect(readLineFrom(`cla${ESC}[Cve\n`).value).toBe("clave");
    expect(readLineFrom(`cla${ESC}[1;5Dve\n`).value).toBe("clave");
    expect(readLineFrom(`cla${ESC}OPve\n`).value).toBe("clave");
  });

  it("un ESC suelto no se come el carácter siguiente", () => {
    expect(readLineFrom(`cla${ESC}ve\n`).value).toBe("clave");
  });

  it("cancela con Ctrl-C y con Ctrl-D en vez de dar por buena la parte tecleada", () => {
    expect(readLineFrom(`media${ETX}`)).toEqual({ status: "cancelled", value: "", rest: "" });
    expect(readLineFrom(`media${EOT}`)).toEqual({ status: "cancelled", value: "", rest: "" });
  });

  it("cuenta los acentos como un carácter y no como sus dos bytes", () => {
    expect(readLineFrom("contraseña\n").value).toBe("contraseña");
    expect(readLineFrom(`contraseña${DEL}\n`).value).toBe("contraseñ");
  });

  it("borra el emoji entero y no media pareja suplente", () => {
    // Un slice a secas partiría el par y dejaría dentro de la contraseña un
    // suplente huérfano que nadie podría volver a teclear.
    expect(readLineFrom(`clave🔑${DEL}\n`).value).toBe("clave");
    expect(readLineFrom("clave🔑\n").value).toBe("clave🔑");
  });
});

describe("findAccount", () => {
  it("encuentra la cuenta y dice si ya tenía contraseña", async () => {
    await crearUsuario(CORREO, "scrypt$N=65536,r=8,p=1$c2FsdA==$a2V5");
    const cuenta = await findAccount(client, CORREO);
    expect(cuenta?.email).toBe(CORREO);
    expect(cuenta?.hasPassword).toBe(true);
    expect(cuenta?.passkeys).toBe(0);
  });

  it("distingue la cuenta sin contraseña, que es la que el rescate existe para salvar", async () => {
    await crearUsuario();
    expect((await findAccount(client, CORREO))?.hasPassword).toBe(false);
  });

  it("cuenta las passkeys, que el rescate no toca", async () => {
    const usuario = await crearUsuario();
    await prisma.webAuthnCredential.create({
      data: {
        userId: usuario.id,
        credentialId: "cred-rescate-tarea14",
        publicKey: "clave",
        counter: 0n,
        transports: ["internal"],
        deviceName: "Móvil",
      },
    });
    expect((await findAccount(client, CORREO))?.passkeys).toBe(1);
  });

  it("devuelve null cuando esa dirección no existe", async () => {
    expect(await findAccount(client, "rescate-tarea14-nadie@example.com")).toBeNull();
  });
});

describe("resetPassword", () => {
  it("escribe un hash que verifica la contraseña tecleada", async () => {
    await crearUsuario();
    await resetPassword(client, CORREO, LARGA);
    const fila = await prisma.user.findUniqueOrThrow({ where: { email: CORREO } });
    expect(fila.passwordHash).not.toBeNull();
    expect(fila.passwordHash).not.toContain(LARGA);
    expect(await verifyPassword(LARGA, fila.passwordHash as string)).toBe(true);
  });

  it("sube token_version en la misma sentencia: sin eso el anterior sigue dentro", async () => {
    await crearUsuario();
    const resultado = await resetPassword(client, CORREO, LARGA);
    expect(resultado?.tokenVersion).toBe(4);
    const fila = await prisma.user.findUniqueOrThrow({ where: { email: CORREO } });
    expect(fila.tokenVersion).toBe(4);
  });

  it("normaliza la dirección, así que la mayúscula que escribe su dueña vale", async () => {
    await crearUsuario();
    const resultado = await resetPassword(client, "  RESCATE-Tarea14@Example.COM  ", LARGA);
    expect(resultado?.email).toBe(CORREO);
  });

  it("rescata de verdad una fila guardada sin normalizar", async () => {
    // Encontrar la fila no basta y es peor que no encontrarla, porque se informa
    // de un éxito que no lo es: el login busca por igualdad exacta
    // (src/lib/auth-password.ts), así que escribir el hash sobre
    // `Rescate-Tarea14-Legado@Example.com` y dejar la grafía como estaba deja
    // una cuenta con contraseña nueva en la que no puede entrar nadie. Por eso
    // la prueba entra de verdad en vez de mirar la fila.
    await crearUsuario("Rescate-Tarea14-Legado@Example.com");
    const resultado = await resetPassword(client, "Rescate-Tarea14-Legado@Example.com", LARGA);
    expect(resultado?.email).toBe("rescate-tarea14-legado@example.com");

    const entrada = await authorizePassword("rescate-tarea14-legado@example.com", LARGA);
    expect(entrada.ok).toBe(true);
  });

  it("normalizar la grafía no cambia nada para una fila que ya lo estaba", async () => {
    await crearUsuario();
    await resetPassword(client, CORREO, LARGA);
    const fila = await prisma.user.findUniqueOrThrow({ where: { email: CORREO } });
    expect(fila.email).toBe(CORREO);
    expect((await authorizePassword(CORREO, LARGA)).ok).toBe(true);
  });

  it("devuelve null si no hay ninguna fila, en vez de decir que ha ido bien", async () => {
    expect(await resetPassword(client, "rescate-tarea14-nadie@example.com", LARGA)).toBeNull();
  });

  it("deja rastro durable en security_logs, que es lo único que queda del rescate", async () => {
    // Sin esta fila, todo el registro de que alguien reescribió una credencial
    // sin sesión y sin autenticarse es la salida de error de una terminal.
    const usuario = await crearUsuario();
    const resultado = await resetPassword(client, CORREO, LARGA);
    expect(resultado?.audited).toBe(true);

    const evento = await prisma.securityLog.findFirstOrThrow({ where: { userId: usuario.id } });
    expect(evento.eventType).toBe("PASSWORD_RESET");
    expect(evento.severity).toBe("WARNING");
    expect(evento.email).toBe(CORREO);
    expect(evento.endpoint).toBe("scripts/auth-password.mjs");
    expect(evento.success).toBe(true);
  });

  it("no mete la contraseña ni el hash en el rastro", async () => {
    await crearUsuario();
    await resetPassword(client, CORREO, LARGA);
    const evento = await prisma.securityLog.findFirstOrThrow({ where: { email: CORREO } });
    const fila = await prisma.user.findUniqueOrThrow({ where: { email: CORREO } });
    const entero = JSON.stringify(evento);
    expect(entero).not.toContain(LARGA);
    expect(entero).not.toContain(fila.passwordHash as string);
  });

  it("un rastro que no se puede escribir no deshace el rescate", async () => {
    // Al revés sería peor de lo que arregla: un enum roto o un disco lleno
    // convertirían «no puedes entrar» en «no puedes entrar y tampoco arreglarlo».
    await crearUsuario();
    await client.query('ALTER TABLE security_logs RENAME TO "security_logs_tarea14"');
    try {
      const resultado = await resetPassword(client, CORREO, LARGA);
      expect(resultado?.audited).toBe(false);
      expect(resultado?.tokenVersion).toBe(4);
      const fila = await prisma.user.findUniqueOrThrow({ where: { email: CORREO } });
      expect(await verifyPassword(LARGA, fila.passwordHash as string)).toBe(true);
    } finally {
      await client.query('ALTER TABLE "security_logs_tarea14" RENAME TO security_logs');
    }
  });

  it("rechaza por debajo del mínimo sin tocar la fila", async () => {
    await crearUsuario();
    await expect(resetPassword(client, CORREO, "corta")).rejects.toThrow(
      new RegExp(String(MIN_PASSWORD_LENGTH)),
    );
    const fila = await prisma.user.findUniqueOrThrow({ where: { email: CORREO } });
    expect(fila.passwordHash).toBeNull();
    expect(fila.tokenVersion).toBe(3);
  });
});
