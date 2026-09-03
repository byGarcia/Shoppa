import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { passkeyAddition, passkeyCopy } from "./passkey-addition.ts";

/**
 * La tarjeta de Ajustes no preguntaba nada y por eso le decía lo mismo a todo el
 * mundo: que al añadir la passkey la contraseña dejaría de funcionar y que
 * recuperarla exigiría una consola en el servidor. Una cuenta migrada de la
 * aplicación anterior tiene passkey y NO tiene contraseña: ahí no había ni una
 * palabra cierta, y el botón ofrecía un borrado que no podía ocurrir.
 */
describe("qué hace de verdad añadir una passkey", () => {
  it("con contraseña, la sustituye: el aviso de siempre era el correcto", () => {
    expect(passkeyAddition({ hasPassword: true, passkeyCount: 0 })).toBe("replaces-password");
  });

  it("con contraseña y passkeys ya puestas sigue habiendo contraseña que perder", () => {
    expect(passkeyAddition({ hasPassword: true, passkeyCount: 3 })).toBe("replaces-password");
  });

  it("sin contraseña y con una passkey, es una llave más", () => {
    expect(passkeyAddition({ hasPassword: false, passkeyCount: 1 })).toBe("additional-key");
  });

  it("sin contraseña y sin ninguna passkey no hay nada que afirmar", () => {
    // No le puede pasar a nadie con sesión —por algún sitio ha entrado— y el
    // servidor lo rechaza igualmente. Se nombra en vez de dejarlo caer en una
    // de las otras dos ramas.
    expect(passkeyAddition({ hasPassword: false, passkeyCount: 0 })).toBe("unprovable");
  });
});

describe("qué texto se saca en cada caso", () => {
  const sinContrasena = passkeyCopy(passkeyAddition({ hasPassword: false, passkeyCount: 2 }));
  const conContrasena = passkeyCopy(passkeyAddition({ hasPassword: true, passkeyCount: 0 }));

  it("una cuenta sin contraseña NO recibe el aviso de que la contraseña dejará de funcionar", () => {
    // La razón de todo este arreglo, en una línea.
    expect(sinContrasena.warning).not.toBe("warning");
    expect(sinContrasena.warning).toBe("warningAdditional");
  });

  it("el botón de una cuenta sin contraseña no ofrece borrarla", () => {
    expect(sinContrasena.confirm).toBe("confirmAdditional");
    expect(es.passkeyCard.confirmAdditional).not.toContain("contraseña");
    expect(en.passkeyCard.confirmAdditional.toLowerCase()).not.toContain("password");
  });

  it("y el aviso que sí recibe no menciona ninguna contraseña que se pierda", () => {
    // El texto en sí, no sólo la clave: es lo que lee quien abre la tarjeta.
    for (const texto of [es.passkeyCard.warningAdditional, en.passkeyCard.warningAdditional]) {
      expect(texto).not.toMatch(/dejará de funcionar|stops your password from working/);
      expect(texto).not.toMatch(/consola en el servidor|console on the server/);
    }
  });

  it("el aviso de éxito tampoco le dice que a partir de ahora entra sin contraseña", () => {
    expect(sinContrasena.added).toBe("addedAdditional");
    expect(es.passkeyCard.addedAdditional).not.toContain("sin contraseña");
    expect(en.passkeyCard.addedAdditional.toLowerCase()).not.toContain("no password");
  });

  it("una cuenta con contraseña conserva el aviso y el botón de siempre", () => {
    expect(conContrasena).toEqual({ warning: "warning", confirm: "confirm", added: "added" });
  });

  it("sin nada con que confirmar no se pinta ningún párrafo", () => {
    // Las dos alternativas afirmarían algo sobre esta cuenta que nadie ha
    // establecido; la tarjeta enseña sólo el rechazo (`noWayToConfirm`).
    expect(passkeyCopy("unprovable").warning).toBeNull();
  });

  it("todas las claves que elige existen en los dos catálogos", () => {
    const estados = [
      { hasPassword: true, passkeyCount: 0 },
      { hasPassword: false, passkeyCount: 1 },
      { hasPassword: false, passkeyCount: 0 },
    ];
    for (const estado of estados) {
      const copia = passkeyCopy(passkeyAddition(estado));
      for (const clave of [copia.warning, copia.confirm, copia.added]) {
        if (clave === null) continue;
        expect(es.passkeyCard, clave).toHaveProperty(clave);
        expect(en.passkeyCard, clave).toHaveProperty(clave);
      }
    }
  });
});
