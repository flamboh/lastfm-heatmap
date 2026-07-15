import { describe, expect, it, vi } from "vitest";
import { fetchDailyCounts, loadActivity } from "../src/lastfm";
import type { ActivitySnapshot, ActivityStore } from "../src/types";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("Last.fm activity", () => {
  it("paginates and groups completed scrobbles by UTC date", async () => {
    const july15 = Date.parse("2026-07-15T00:00:00Z") / 1000;
    const july15OneAm = Date.parse("2026-07-15T01:00:00Z") / 1000;
    const july16 = Date.parse("2026-07-16T00:00:00Z") / 1000;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((input) => {
      const page = new URL(String(input)).searchParams.get("page");
      return Promise.resolve(
        jsonResponse({
          recenttracks: {
            "@attr": { totalPages: "2" },
            track:
              page === "1"
                ? [
                    { "@attr": { nowplaying: "true" } },
                    { date: { uts: String(july15) } },
                  ]
                : [
                    { date: { uts: String(july15OneAm) } },
                    { date: { uts: String(july16) } },
                  ],
          },
        }),
      );
    });

    const counts = await fetchDailyCounts({
      username: "listener",
      apiKey: "secret",
      from: july15,
      to: july16 + 86_400,
      fetcher,
    });

    expect(counts).toEqual({ "2026-07-15": 2, "2026-07-16": 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("limit")).toBe("200");
    expect(firstUrl.searchParams.get("from")).toBe(String(july15 - 1));
  });

  it("returns a fresh durable snapshot without calling Last.fm", async () => {
    const snapshot: ActivitySnapshot = {
      username: "listener",
      counts: { "2026-07-15": 3 },
      fetchedThrough: 1784160000,
      updatedAt: 1784160000,
    };
    const store: ActivityStore = {
      get: vi.fn().mockResolvedValue(snapshot),
      put: vi.fn(),
    };
    const fetcher = vi.fn<typeof fetch>();

    const result = await loadActivity({
      username: "listener",
      apiKey: "secret",
      store,
      fetcher,
      now: new Date("2026-07-15T01:00:00Z"),
    });

    expect(result).toBe(snapshot);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("replaces the overlap window instead of double-counting it", async () => {
    let stored: ActivitySnapshot | null = {
      username: "listener",
      counts: { "2026-07-12": 5, "2026-07-14": 9 },
      fetchedThrough: Date.parse("2026-07-15T00:00:00Z") / 1000,
      updatedAt: Date.parse("2026-07-14T00:00:00Z") / 1000,
    };
    const store: ActivityStore = {
      get: vi.fn(async () => stored),
      put: vi.fn(async (_key, value) => {
        stored = value;
      }),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        recenttracks: {
          "@attr": { totalPages: "1" },
          track: [
            {
              date: { uts: String(Date.parse("2026-07-14T12:00:00Z") / 1000) },
            },
          ],
        },
      }),
    );

    const result = await loadActivity({
      username: "listener",
      apiKey: "secret",
      store,
      fetcher,
      now: new Date("2026-07-15T12:00:00Z"),
    });

    expect(result.counts).toEqual({ "2026-07-12": 5, "2026-07-14": 1 });
  });
});
