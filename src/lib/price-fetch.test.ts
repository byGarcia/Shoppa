import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El coste real de `local` es la espera: HOME_FETCH_WAIT_MS son 30 s por
 * producto esperando a un lector que en esta modalidad no existe. Aquí se
 * comprueba que la cola ni se toca.
 */
const enqueueFetch = vi.hoisted(() => vi.fn((url: string): unknown => ({ id: "1", url })));
const awaitFetch = vi.hoisted(() =>
  // Si alguien la llama, la prueba se cuelga en vez de pasar por casualidad.
  vi.fn((): Promise<unknown> => new Promise(() => {})),
);
vi.mock("./fetch-jobs", () => ({ enqueueFetch, awaitFetch }));

// Sin esto, comprobar la URL sale a Internet a resolver el dominio.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34" }]),
}));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, APP_ORIGIN: "https://a.example" };
  enqueueFetch.mockClear();
  awaitFetch.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

const PAGINA = '<html><head><title>Producto</title></head><body>12,50 EUR</body></html>';

function respuesta(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

describe("fetchProductHtml en modo local", () => {
  it("no pide ayuda a casa aunque la tienda dé la callada por respuesta", async () => {
    process.env.PRICE_FETCH_MODE = "local";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    // Relojes falsos que nadie adelanta: si la promesa se resolviera esperando
    // un temporizador, esta prueba no terminaría.
    vi.useFakeTimers();

    const { fetchProductHtml } = await import("./price-fetch.ts");
    const resultado = await fetchProductHtml("https://tienda.example/producto");

    expect(resultado.ok).toBe(false);
    expect(enqueueFetch).not.toHaveBeenCalled();
    expect(awaitFetch).not.toHaveBeenCalled();
  });

  it("tampoco la pide en las tiendas que la piden siempre", async () => {
    // Amazon es la tienda para la que el lector de casa va PRIMERO. En local no
    // hay lector, así que la petición tiene que salir de aquí igualmente.
    process.env.PRICE_FETCH_MODE = "local";
    const doble = vi.fn(async () => respuesta(PAGINA));
    vi.stubGlobal("fetch", doble);
    vi.useFakeTimers();

    const { fetchProductHtml } = await import("./price-fetch.ts");
    const resultado = await fetchProductHtml("https://www.amazon.es/dp/B000000000");

    expect(resultado.ok).toBe(true);
    expect(enqueueFetch).not.toHaveBeenCalled();
    expect(doble).toHaveBeenCalled();
  });

  it("en modo assisted la cola vuelve a usarse", async () => {
    process.env.PRICE_FETCH_MODE = "assisted";
    awaitFetch.mockImplementation(async () => ({ html: PAGINA }));
    vi.stubGlobal("fetch", vi.fn(async () => respuesta(PAGINA)));

    const { fetchProductHtml } = await import("./price-fetch.ts");
    const resultado = await fetchProductHtml("https://www.amazon.es/dp/B000000000");

    expect(resultado.ok).toBe(true);
    expect(enqueueFetch).toHaveBeenCalledWith("https://www.amazon.es/dp/B000000000");
  });
});
