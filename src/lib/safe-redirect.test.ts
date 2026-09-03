import { describe, expect, it } from "vitest";

import { safeRedirect } from "./safe-redirect.ts";

const ORIGIN = "https://casa.example/login";

describe("safeRedirect", () => {
  it("deja pasar una ruta del propio origen", () => {
    expect(safeRedirect("/precios")).toBe("/precios");
    expect(safeRedirect("/ajustes/supers?x=1")).toBe("/ajustes/supers?x=1");
    expect(safeRedirect("/")).toBe("/");
  });

  it("rechaza una URL absoluta", () => {
    expect(safeRedirect("https://evil.example/robo")).toBe("/");
  });

  it("rechaza la relativa al protocolo y el truco de la barra invertida", () => {
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("/\\evil.example")).toBe("/");
  });

  it("rechaza el tabulador que el analizador de URL borra antes de analizar", () => {
    // El pago de esta prueba: "/\t/evil.example" pasa las tres comprobaciones de
    // prefijo tal cual, y después new URL() quita el tabulador y resuelve a
    // https://evil.example/. Comprobar la cadena que el analizador no verá es
    // comprobar la cadena equivocada.
    expect(new URL("/\t/evil.example", ORIGIN).href).toBe("https://evil.example/");
    expect(safeRedirect("/\t/evil.example")).toBe("/");
  });

  it("rechaza el salto de línea y el retorno de carro por el mismo motivo", () => {
    expect(safeRedirect("/\n/evil.example")).toBe("/");
    expect(safeRedirect("/\r/evil.example")).toBe("/");
    expect(safeRedirect("/\r\n/evil.example")).toBe("/");
    expect(safeRedirect("/\t\\evil.example")).toBe("/");
  });

  it("lo que devuelve resuelve siempre dentro del origen", () => {
    for (const payload of [
      "/\t/evil.example",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/\t\t//evil.example",
    ]) {
      expect(new URL(safeRedirect(payload), ORIGIN).origin).toBe("https://casa.example");
    }
  });
});
