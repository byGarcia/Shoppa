import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three assisted routes under PRICE_FETCH_MODE=local.
 *
 * The modules that drag the database in are stubbed because the 410 comes out
 * before anything is touched: if checking that a door is shut required bringing
 * Postgres up, the test would be measuring something else.
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
// If the 410 came out AFTER authentication, the response would be a 401 and
// this test would see it: the stub approves anyone.
vi.mock("@/lib/api-key", () => ({ requireApiKey: vi.fn(async () => null) }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, APP_ORIGIN: "https://a.example", PRICE_FETCH_MODE: "local" };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

function request(url: string, method = "GET"): NextRequest {
  return new NextRequest(new Request(url, method === "GET" ? undefined : { method, body: "" }));
}

describe("assisted routes in local mode", () => {
  it("the work queue answers 410", async () => {
    const { GET } = await import("./queue/route.ts");
    const response = await GET(request("https://a.example/api/prices/queue"));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: expect.stringContaining("PRICE_FETCH_MODE") });
  });

  it("the HTML handoff answers 410", async () => {
    const { POST } = await import("./ingest/route.ts");
    const response = await POST(request("https://a.example/api/prices/ingest?id=x", "POST"));
    expect(response.status).toBe(410);
  });

  it("the fetcher's mailbox answers 410 on GET and on POST", async () => {
    const { GET, POST } = await import("./fetch-jobs/route.ts");
    expect((await GET(request("https://a.example/api/prices/fetch-jobs"))).status).toBe(410);
    expect(
      (await POST(request("https://a.example/api/prices/fetch-jobs?id=x", "POST"))).status,
    ).toBe(410);
  });

  it("in assisted mode all three still answer", async () => {
    process.env.PRICE_FETCH_MODE = "assisted";
    const { GET } = await import("./fetch-jobs/route.ts");
    const response = await GET(request("https://a.example/api/prices/fetch-jobs"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobs: [] });
  });
});
