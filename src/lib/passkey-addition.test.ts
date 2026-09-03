import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import {
  closedPasskeyCard,
  passkeyAddition,
  passkeyCopy,
  passkeyUse,
  type PasskeyListEntry,
} from "./passkey-addition.ts";

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

/* -------------------------------------------------------------------------- */

const IPHONE: PasskeyListEntry = {
  // El id de la FILA, que es lo que acepta la ruta de borrado. Nunca el id de
  // la credencial: ése no sale de src/server/webauthn.
  id: "fila-del-iphone",
  deviceName: "iPhone",
  createdAt: "2026-06-01T09:00:00.000Z",
  lastUsedAt: "2026-09-02T07:14:00.000Z",
};
const RECIEN_CREADA: PasskeyListEntry = {
  id: "fila-del-mac",
  deviceName: "Mac",
  // Las dos columnas por defecto valen `now()`: una credencial que no ha
  // entrado nunca sigue llevando su hora de creación en `last_used_at`.
  createdAt: "2026-09-01T12:00:00.000Z",
  lastUsedAt: "2026-09-01T12:00:00.000Z",
};

/** Una cuenta migrada de la aplicación anterior: passkeys y ninguna contraseña. */
function migrada(passkeys: PasskeyListEntry[]) {
  return { hasPassword: false, passkeys };
}

describe("cuándo se usó una passkey", () => {
  it("con una fecha de uso posterior, la nombra", () => {
    expect(passkeyUse(IPHONE)).toEqual({ key: "lastUse", at: IPHONE.lastUsedAt });
  });

  it("recién registrada y sin estrenar, no inventa un día en el que no pasó nada", () => {
    expect(passkeyUse(RECIEN_CREADA)).toEqual({ key: "neverUsed" });
  });

  it("una fecha ilegible no se convierte en un uso", () => {
    expect(passkeyUse({ createdAt: "", lastUsedAt: "" })).toEqual({ key: "neverUsed" });
  });
});

/**
 * La papelera de cada fila, y la fila a la que se le quita.
 *
 * Una cuenta migrada de la aplicación anterior no tiene contraseña: sus
 * passkeys son toda la forma de entrar que hay, y esta versión no tiene ninguna
 * pantalla que vuelva a poner una contraseña. Borrar la última no es un error
 * del que se sale reintentando: es una puerta cerrada con `psql` detrás.
 */
describe("qué filas pueden retirarse", () => {
  it("con dos llaves y sin contraseña, cualquiera de las dos", () => {
    const carta = closedPasskeyCard({ available: true, account: migrada([IPHONE, RECIEN_CREADA]) });
    expect(carta.passkeys.map((p) => p.removable)).toEqual([true, true]);
    expect(carta.explainLastKey).toBe(false);
  });

  it("con una sola llave y sin contraseña, ninguna: es la única forma de entrar", () => {
    const carta = closedPasskeyCard({ available: true, account: migrada([IPHONE]) });
    expect(carta.passkeys.map((p) => p.removable)).toEqual([false]);
  });

  it("y la tarjeta lo explica en vez de dejar una fila distinta sin decir por qué", () => {
    const carta = closedPasskeyCard({ available: true, account: migrada([IPHONE]) });
    expect(carta.explainLastKey).toBe(true);
    expect(es.passkeyCard).toHaveProperty("deleteLast");
    expect(en.passkeyCard).toHaveProperty("deleteLast");
  });

  it("con una sola llave PERO con contraseña, sí puede retirarse: queda otra puerta", () => {
    const carta = closedPasskeyCard({
      available: true,
      account: { hasPassword: true, passkeys: [IPHONE] },
    });
    expect(carta.passkeys.map((p) => p.removable)).toEqual([true]);
    expect(carta.explainLastKey).toBe(false);
  });

  it("sin ninguna llave no hay nada que explicar", () => {
    const carta = closedPasskeyCard({ available: true, account: migrada([]) });
    expect(carta.explainLastKey).toBe(false);
  });

  it("cada fila lleva el id de su fila, que es el asa que acepta la ruta", () => {
    const carta = closedPasskeyCard({ available: true, account: migrada([IPHONE, RECIEN_CREADA]) });
    expect(carta.passkeys.map((p) => p.id)).toEqual(["fila-del-iphone", "fila-del-mac"]);
  });

  // Esconder la papelera es una cortesía, no la guarda: otra pestaña con la
  // lista de hace un minuto llega a la ruta con una fila que aquí valía true.
  it("las claves de la papelera existen en los dos catálogos", () => {
    for (const clave of ["deleteLabel", "deleteConfirm", "deleted", "deleteFailed", "deleteLast"]) {
      expect(es.passkeyCard, clave).toHaveProperty(clave);
      expect(en.passkeyCard, clave).toHaveProperty(clave);
    }
  });
});

/**
 * El defecto que da nombre a este trabajo. Quien entra con su passkey todos los
 * días abría Ajustes y encontraba la misma tarjeta que alguien que no tiene
 * ninguna: el mismo subtítulo, el mismo botón «Añadir» y nada, en ninguna parte,
 * que reconociera la llave que acababa de usar. La tarjeta sólo preguntaba por
 * la cuenta al abrir el panel, así que cerrada —que es como está en la pantalla—
 * no sabía nada.
 */
describe("la tarjeta cerrada de Ajustes", () => {
  const conUna = closedPasskeyCard({ available: true, account: migrada([IPHONE]) });

  it("con una passkey, no dice en ningún sitio que la cuenta no tenga ninguna", () => {
    // Ni el subtítulo de estreno ni el botón de la primera llave.
    expect(conUna.subtitle.key).not.toBe("subtitleReady");
    expect(conUna.action).not.toBe("add");
    // Y sí la enseña.
    expect(conUna.passkeys.map((p) => p.deviceName)).toEqual(["iPhone"]);
  });

  it("dice cuántas tiene, contadas", () => {
    expect(conUna.subtitle).toEqual({ key: "subtitleCount", count: 1 });
    const conTres = closedPasskeyCard({
      available: true,
      account: migrada([IPHONE, RECIEN_CREADA, { ...IPHONE, id: "otra-fila" }]),
    });
    expect(conTres.subtitle).toEqual({ key: "subtitleCount", count: 3 });
  });

  it("el botón ofrece una llave más, no la primera", () => {
    expect(conUna.action).toBe("addAnother");
  });

  it("sin ninguna passkey sí ofrece la primera, con el texto de siempre", () => {
    const vacia = closedPasskeyCard({ available: true, account: migrada([]) });
    expect(vacia.subtitle).toEqual({ key: "subtitleReady" });
    expect(vacia.action).toBe("add");
    expect(vacia.passkeys).toEqual([]);
  });

  it("mientras el servidor no ha contestado no afirma ninguna de las dos cosas", () => {
    // El parpadeo entre dos afirmaciones sobre la cuenta es exactamente la
    // clase de defecto que se está arreglando: aquí no hay botón que leer.
    const cargando = closedPasskeyCard({ available: true, account: null });
    expect(cargando.subtitle).toEqual({ key: "subtitleChecking" });
    expect(cargando.action).toBeNull();
    expect(cargando.passkeys).toEqual([]);
  });

  it("si la consulta falla lo dice, en vez de quedarse comprobando para siempre", () => {
    const fallo = closedPasskeyCard({ available: true, account: null, failed: true });
    expect(fallo.subtitle).toEqual({ key: "checkFailed" });
    expect(fallo.action).toBeNull();
  });

  it("por http avisa de la conexión, pero sigue enseñando las llaves que hay", () => {
    // La instancia no puede crear una passkey ahí; las que tiene la cuenta
    // siguen existiendo, y esconderlas volvería a dejar la tarjeta sin decir
    // nada de la cuenta.
    const insegura = closedPasskeyCard({ available: false, account: migrada([IPHONE]) });
    expect(insegura.subtitle).toEqual({ key: "subtitleInsecure" });
    expect(insegura.passkeys.map((p) => p.deviceName)).toEqual(["iPhone"]);
    expect(insegura.action).toBe("addAnother");
  });

  it("todas las claves que elige existen en los dos catálogos", () => {
    const cartas = [
      conUna,
      closedPasskeyCard({ available: true, account: migrada([]) }),
      closedPasskeyCard({ available: true, account: null }),
      closedPasskeyCard({ available: true, account: null, failed: true }),
      closedPasskeyCard({ available: false, account: null }),
    ];
    for (const carta of cartas) {
      for (const clave of [carta.subtitle.key, carta.action]) {
        if (clave === null) continue;
        expect(es.passkeyCard, clave).toHaveProperty(clave);
        expect(en.passkeyCard, clave).toHaveProperty(clave);
      }
    }
    for (const clave of ["listTitle", "lastUse", "neverUsed"]) {
      expect(es.passkeyCard, clave).toHaveProperty(clave);
      expect(en.passkeyCard, clave).toHaveProperty(clave);
    }
  });
});

describe("el recuento, tal y como se lee en pantalla", () => {
  // Con el mismo formateador que usa la aplicación: un plural ICU, no dos
  // trozos de texto pegados a un número.
  it("en castellano concuerda en singular y en plural", () => {
    const t = createTranslator({ locale: "es", messages: es, namespace: "passkeyCard" });
    expect(t("subtitleCount", { count: 1 })).toBe("Ya tienes 1 passkey en esta cuenta");
    expect(t("subtitleCount", { count: 3 })).toBe("Ya tienes 3 passkeys en esta cuenta");
  });

  it("y en inglés también", () => {
    const t = createTranslator({ locale: "en", messages: en, namespace: "passkeyCard" });
    expect(t("subtitleCount", { count: 1 })).toBe("You already have 1 passkey on this account");
    expect(t("subtitleCount", { count: 4 })).toBe("You already have 4 passkeys on this account");
  });

  it("el botón de la primera llave y el de una más no dicen lo mismo", () => {
    // Si coincidieran, la cuenta con passkey volvería a leer «Añadir» y el
    // arreglo no se notaría en la pantalla.
    expect(es.passkeyCard.addAnother).not.toBe(es.passkeyCard.add);
    expect(en.passkeyCard.addAnother).not.toBe(en.passkeyCard.add);
  });
});
