import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Las tres rutas asistidas con PRICE_FETCH_MODE=local.
 *
 * Los módulos que arrastran la base de datos se doblan porque el 410 sale antes
 * de tocar nada: si para comprobar que una puerta está cerrada hiciera falta
 * levantar Postgres, la prueba estaría midiendo otra cosa.
 */
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/lib/price-service", () => ({
  listDueProducts: vi.fn(),
  processProductHtml: vi.fn(),
}));
vi.mock("@/lib/fetch-jobs", () => ({
  listPendingJobs: vi.fn(() => []),
  completeFetch: vi.fn(() => true),
}));
// Si el 410 saliera DESPUÉS de la autenticación, la respuesta sería un 401 y
// esta prueba lo vería: el doble aprueba a cualquiera.
vi.mock("@/lib/api-key", () => ({ requireApiKey: vi.fn(async () => null) }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, APP_ORIGIN: "https://a.example", PRICE_FETCH_MODE: "local" };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function peticion(url: string, method = "GET"): NextRequest {
  return new NextRequest(new Request(url, method === "GET" ? undefined : { method, body: "" }));
}

describe("rutas asistidas en modo local", () => {
  it("la cola de trabajo contesta 410", async () => {
    const { GET } = await import("./queue/route.ts");
    const respuesta = await GET(peticion("https://a.example/api/prices/queue"));
    expect(respuesta.status).toBe(410);
    expect(await respuesta.json()).toEqual({ error: expect.stringContaining("PRICE_FETCH_MODE") });
  });

  it("la entrega de HTML contesta 410", async () => {
    const { POST } = await import("./ingest/route.ts");
    const respuesta = await POST(peticion("https://a.example/api/prices/ingest?id=x", "POST"));
    expect(respuesta.status).toBe(410);
  });

  it("el buzón del lector contesta 410 en GET y en POST", async () => {
    const { GET, POST } = await import("./fetch-jobs/route.ts");
    expect((await GET(peticion("https://a.example/api/prices/fetch-jobs"))).status).toBe(410);
    expect(
      (await POST(peticion("https://a.example/api/prices/fetch-jobs?id=x", "POST"))).status,
    ).toBe(410);
  });

  it("en modo assisted las tres siguen atendiendo", async () => {
    process.env.PRICE_FETCH_MODE = "assisted";
    const { GET } = await import("./fetch-jobs/route.ts");
    const respuesta = await GET(peticion("https://a.example/api/prices/fetch-jobs"));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ jobs: [] });
  });
});
