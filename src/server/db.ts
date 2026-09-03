import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  Prisma,
  type GroceryItem,
  type TrackedProduct,
} from "@/generated/prisma/client";

export { Prisma };
export type { GroceryItem, TrackedProduct };

const globalForPrisma = globalThis as unknown as {
  shoppaPrisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({
    adapter: new PrismaPg(connectionString, {
      onPoolError: (error) => console.error("PostgreSQL pool error", error),
    }),
  });
}

export function getDb(): PrismaClient {
  globalForPrisma.shoppaPrisma ??= createClient();
  return globalForPrisma.shoppaPrisma;
}

export const prisma = getDb();
