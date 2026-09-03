import { describe, expect, it } from "vitest";

import { safeRedirect } from "./safe-redirect.ts";

const ORIGIN = "https://casa.example/login";

describe("safeRedirect", () => {
  it("lets a path of the origin itself through", () => {
    expect(safeRedirect("/precios")).toBe("/precios");
    expect(safeRedirect("/ajustes/supers?x=1")).toBe("/ajustes/supers?x=1");
    expect(safeRedirect("/")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeRedirect("https://evil.example/robo")).toBe("/");
  });

  it("rejects the protocol-relative one and the backslash trick", () => {
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("/\\evil.example")).toBe("/");
  });

  it("rejects the tab that the URL parser strips before parsing", () => {
    // What this test buys: "/\t/evil.example" passes all three prefix checks
    // as it stands, and then new URL() removes the tab and resolves to
    // https://evil.example/. Checking the string the parser will not see is
    // checking the wrong string.
    expect(new URL("/\t/evil.example", ORIGIN).href).toBe("https://evil.example/");
    expect(safeRedirect("/\t/evil.example")).toBe("/");
  });

  it("rejects the line feed and the carriage return for the same reason", () => {
    expect(safeRedirect("/\n/evil.example")).toBe("/");
    expect(safeRedirect("/\r/evil.example")).toBe("/");
    expect(safeRedirect("/\r\n/evil.example")).toBe("/");
    expect(safeRedirect("/\t\\evil.example")).toBe("/");
  });

  it("whatever it returns always resolves inside the origin", () => {
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
