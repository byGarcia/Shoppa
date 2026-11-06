import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  hints: [] as { normalizedName: string; categoryId: string | null; storeHintId: string | null }[],
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: {
    itemCategoryHint: { findMany: async () => db.hints },
    groceryItem: {
      findFirst: (...a: unknown[]) => db.findFirst(...a),
      create: (...a: unknown[]) => db.create(...a),
      update: (...a: unknown[]) => db.update(...a),
    },
  },
}));

const { addOrReviveItem } = await import("./grocery-server.ts");

beforeEach(() => {
  db.hints = [];
  db.findFirst.mockReset().mockResolvedValue(null);
  db.create.mockReset().mockImplementation(async ({ data }) => ({ id: "new", checked: false, ...data }));
  db.update.mockReset();
});

const add = (name: string, storeId: string | null) =>
  addOrReviveItem({ name, storeId, source: "SIRI", addedByUserId: "u1" });

describe("addOrReviveItem destination", () => {
  it("files an item with no shop under the shop it was last moved to", async () => {
    db.hints = [{ normalizedName: "leche", categoryId: "dairy", storeHintId: "shop-a" }];

    const { item } = await add("Leche", null);

    expect(item.storeId).toBe("shop-a");
    expect(db.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { normalizedName: "leche", storeId: "shop-a" } }),
    );
  });

  it("keeps an item nobody has placed before in the inbox", async () => {
    db.hints = [{ normalizedName: "leche", categoryId: "dairy", storeHintId: null }];

    const { item } = await add("Leche", null);

    expect(item.storeId).toBeNull();
  });

  it("does not file by the looser word match, only suggests", async () => {
    db.hints = [{ normalizedName: "leche", categoryId: "dairy", storeHintId: "shop-a" }];

    const { item } = await add("leche de avena", null);

    expect(item.storeId).toBeNull();
    expect(item.categoryId).toBe("dairy");
  });

  it("never overrides the shop the caller named", async () => {
    db.hints = [{ normalizedName: "leche", categoryId: "dairy", storeHintId: "shop-a" }];

    const { item } = await add("Leche", "shop-b");

    expect(item.storeId).toBe("shop-b");
  });

  it("brings back a ticked item in the learned shop instead of duplicating it", async () => {
    db.hints = [{ normalizedName: "leche", categoryId: "dairy", storeHintId: "shop-a" }];
    db.findFirst.mockResolvedValue({ id: "old", storeId: "shop-a", checked: true });
    db.update.mockImplementation(async ({ where, data }) => ({ id: where.id, storeId: "shop-a", ...data }));

    const { item, reused } = await add("leche", null);

    expect(reused).toBe(true);
    expect(item).toMatchObject({ id: "old", storeId: "shop-a", checked: false });
    expect(db.create).not.toHaveBeenCalled();
  });
});
