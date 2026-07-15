import { describe, expect, it, vi } from "vitest";
import { createHandler } from "../src/index";
import type { Env, ExecutionContextLike } from "../src/types";

function testContext(): ExecutionContextLike {
  return { waitUntil: vi.fn() };
}

function testEnv(): Env {
  const values = new Map<string, string>();
  return {
    LASTFM_API_KEY: "secret",
    ACTIVITY_CACHE: {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
    } as unknown as KVNamespace,
  };
}

function edgeCache(): Pick<Cache, "match" | "put"> {
  const values = new Map<string, Response>();
  return {
    match: vi.fn(async (request: RequestInfo | URL) => {
      const key = request instanceof Request ? request.url : String(request);
      return values.get(key)?.clone();
    }),
    put: vi.fn(async (request: RequestInfo | URL, response: Response) => {
      const key = request instanceof Request ? request.url : String(request);
      values.set(key, response.clone());
    }),
  };
}

describe("public handler", () => {
  it("documents the one-segment embed interface at the root", async () => {
    const handle = createHandler({ edgeCache: edgeCache() });
    const response = await handle(
      new Request("https://graph.example/"),
      testEnv(),
      testContext(),
    );

    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain(
      'src="https://graph.example/YOUR_USERNAME"',
    );
  });

  it("rejects invalid usernames without calling Last.fm", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const handle = createHandler({ fetcher, edgeCache: edgeCache() });
    const response = await handle(
      new Request("https://graph.example/a%2Fb"),
      testEnv(),
      testContext(),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns and schedules caching of a generated SVG", async () => {
    const context = testContext();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        recenttracks: { "@attr": { totalPages: "1" }, track: [] },
      }),
    );
    const handle = createHandler({
      fetcher,
      edgeCache: edgeCache(),
      now: () => new Date("2026-07-15T12:00:00Z"),
    });
    const response = await handle(
      new Request("https://graph.example/listener"),
      testEnv(),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=21600");
    expect(await response.text()).toContain("listener's Last.fm activity");
    expect(context.waitUntil).toHaveBeenCalledOnce();
  });

  it("supports an explicit SVG extension", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        recenttracks: { "@attr": { totalPages: "1" }, track: [] },
      }),
    );
    const handle = createHandler({ fetcher, edgeCache: edgeCache() });
    const response = await handle(
      new Request("https://graph.example/listener.svg"),
      testEnv(),
      testContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("listener's Last.fm activity");
  });

  it("requires an explicit PNG theme", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const handle = createHandler({ fetcher, edgeCache: edgeCache() });
    const response = await handle(
      new Request("https://graph.example/listener.png"),
      testEnv(),
      testContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "PNG requests require ?theme=light or ?theme=dark",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unknown display modes", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const handle = createHandler({ fetcher, edgeCache: edgeCache() });
    const response = await handle(
      new Request("https://graph.example/listener.svg?display=compact"),
      testEnv(),
      testContext(),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "display must be full, dates, or minimal",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a fixed-theme PNG", async () => {
    const context = testContext();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        recenttracks: { "@attr": { totalPages: "1" }, track: [] },
      }),
    );
    const rasterize = vi.fn(
      async (_svg: string) => new Uint8Array([137, 80, 78, 71]),
    );
    const handle = createHandler({
      fetcher,
      rasterize,
      edgeCache: edgeCache(),
      now: () => new Date("2026-07-15T12:00:00Z"),
    });
    const response = await handle(
      new Request(
        "https://graph.example/listener.png?theme=dark&display=minimal",
      ),
      testEnv(),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
    expect(rasterize).toHaveBeenCalledOnce();
    expect(rasterize.mock.calls[0]?.[0]).toContain(
      ".level-0 { fill: #111111; }",
    );
    expect(rasterize.mock.calls[0]?.[0]).not.toContain(
      "@media (prefers-color-scheme: dark)",
    );
    expect(rasterize.mock.calls[0]?.[0]).toContain('width="686" height="88"');
    expect(context.waitUntil).toHaveBeenCalledOnce();
  });
});
