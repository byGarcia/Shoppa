import { describe, expect, it } from "vitest";

import { categoryDisplayName } from "./category-name.ts";

const t = (key: string) => ({ "gcat-hogar": "Home" })[key] ?? key;

describe("categoryDisplayName", () => {
  it("traduce una categoría de fábrica", () => {
    expect(categoryDisplayName({ nameKey: "gcat-hogar", name: "Hogar" }, t)).toBe("Home");
  });

  it("respeta el nombre guardado cuando alguien la renombró", () => {
    expect(categoryDisplayName({ nameKey: null, name: "Trastos" }, t)).toBe("Trastos");
  });

  it("respeta el nombre de una categoría creada por la casa", () => {
    expect(categoryDisplayName({ nameKey: null, name: "Bebés" }, t)).toBe("Bebés");
  });
});
