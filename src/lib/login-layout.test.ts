import { describe, expect, it } from "vitest";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { loginLayout } from "./login-layout.ts";

/**
 * El aviso: con AUTH_MODE=auto la pantalla ofrecía un botón de passkey y, justo
 * debajo y con el mismo peso, un campo de contraseña. Toda cuenta migrada de la
 * aplicación anterior tiene passkey y NO tiene contraseña: para todas ellas ese
 * campo no podía funcionar nunca.
 *
 * Se reordena, no se quita. El servidor no puede saber cuál de las dos tiene
 * quien mira la pantalla, y sobre todo no debe averiguarlo: una pantalla que
 * enseñara el campo sólo a las cuentas que tienen contraseña estaría contestando
 * «¿existe esta dirección aquí y cómo entra?» a cualquiera que teclee un correo.
 */
describe("qué ofrece la pantalla de entrada en cada AUTH_MODE", () => {
  it("auto: la passkey es la acción y la contraseña espera detrás de un control", () => {
    expect(loginLayout("auto")).toEqual({ passkey: true, passwordSlot: "behind-reveal" });
  });

  it("passkey: no hay contraseña que revelar, ni escondida", () => {
    expect(loginLayout("passkey")).toEqual({ passkey: true, passwordSlot: "absent" });
  });

  it("password: sin botón de passkey, la contraseña no es la segunda opción sino el formulario", () => {
    // Escondida detrás de un control sería esconder la única puerta que hay.
    expect(loginLayout("password")).toEqual({ passkey: false, passwordSlot: "primary" });
  });

  it("en los tres modos hay al menos una forma de entrar en la pantalla", () => {
    for (const mode of ["auto", "passkey", "password"] as const) {
      const layout = loginLayout(mode);
      expect(layout.passkey || layout.passwordSlot !== "absent", mode).toBe(true);
    }
  });

  // Lo que NO entra por la puerta: la función no recibe ni el correo, ni la
  // cuenta, ni nada leído de la base de datos. Su única entrada es la
  // configuración de la instancia, que es la misma para todo el que la visita.
  it("la misma instancia enseña lo mismo a todo el mundo", () => {
    expect(loginLayout("auto")).toEqual(loginLayout("auto"));
    expect(loginLayout.length).toBe(1);
  });
});

describe("los textos de la pantalla de entrada", () => {
  it("el control que revela la contraseña está en los dos catálogos", () => {
    expect(es.login).toHaveProperty("passwordReveal");
    expect(en.login).toHaveProperty("passwordReveal");
  });

  it("la etiqueta del campo ya no dice «o», que era falso sin botón de passkey", () => {
    // Con AUTH_MODE=password no hay ninguna otra opción de la que ésta sea la
    // alternativa, y «O entra con tu contraseña» leía como si la hubiera.
    expect(es.login.passwordLabel).not.toMatch(/^O /);
    expect(en.login.passwordLabel.toLowerCase()).not.toMatch(/^or /);
  });

  it("y la línea bajo el botón ya no promete que aquí no hay contraseñas", () => {
    // Estaba justo encima del control que ofrece una.
    expect(es.login.passkeyHint).not.toContain("Sin contraseñas");
    expect(en.login.passkeyHint).not.toContain("No passwords");
  });
});
