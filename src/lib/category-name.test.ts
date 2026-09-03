import { describe, expect, it } from "vitest";

import { categoryDisplayName } from "./category-name.ts";

const t = (key: string) => ({ "gcat-hogar": "Home" })[key] ?? key;

describe("categoryDisplayName", () => {
  it("translates a factory category", () => {
    expect(categoryDisplayName({ nameKey: "gcat-hogar", name: "Hogar" }, t)).toBe("Home");
  });

  it("respects the stored name when someone has renamed it", () => {
    expect(categoryDisplayName({ nameKey: null, name: "Trastos" }, t)).toBe("Trastos");
  });

  it("respects the name of a category created by the household", () => {
    expect(categoryDisplayName({ nameKey: null, name: "Bebés" }, t)).toBe("Bebés");
  });
});
