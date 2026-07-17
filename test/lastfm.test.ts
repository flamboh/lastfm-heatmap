import { describe, expect, it, vi } from "vitest";
import { fetchDailyCounts, loadActivity, streakDays } from "../src/lastfm";
import type { ActivitySnapshot, ActivityStore } from "../src/types";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("Last.fm activity", () => {
  it("paginates and groups completed scrobbles by Los Angeles date", async () => {
    const july14Late = Date.parse("2026-07-15T06:59:59Z") / 1000;
    const july15 = Date.parse("2026-07-15T07:00:00Z") / 1000;
    const july15Later = Date.parse("2026-07-16T01:00:00Z") / 1000;
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
                    { date: { uts: String(july14Late) } },
                  ]
                : [
                    { date: { uts: String(july15) } },
                    { date: { uts: String(july15Later) } },
                  ],
          },
        }),
      );
    });

    const counts = await fetchDailyCounts({
      username: "listener",
      apiKey: "secret",
      from: july15,
      to: july15Later + 86_400,
      fetcher,
    });

    expect(counts).toEqual({ "2026-07-14": 1, "2026-07-15": 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(firstUrl.searchParams.get("limit")).toBe("200");
    expect(firstUrl.searchParams.get("from")).toBe(String(july15 - 1));
  });

  it("accepts Last.fm's empty zero-page response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        recenttracks: { "@attr": { totalPages: "0" }, track: [] },
      }),
    );

    const counts = await fetchDailyCounts({
      username: "new-listener",
      apiKey: "secret",
      from: Date.parse("2026-07-14T00:00:00Z") / 1000,
      to: Date.parse("2026-07-15T00:00:00Z") / 1000,
      fetcher,
    });

    expect(counts).toEqual({});
    expect(fetcher).toHaveBeenCalledOnce();
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
      counts: { "2026-07-11": 5, "2026-07-14": 9 },
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

    expect(result.counts).toEqual({ "2026-07-11": 5, "2026-07-14": 1 });
  });

  it("initializes a streak from cached daily counts", async () => {
    const snapshot: ActivitySnapshot = {
      username: "listener",
      counts: {
        "2026-07-12": 1,
        "2026-07-13": 4,
        "2026-07-14": 2,
      },
      fetchedThrough: Date.parse("2026-07-15T00:00:00Z") / 1000,
      updatedAt: Date.parse("2026-07-15T00:00:00Z") / 1000,
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
      includeStreak: true,
    });

    expect(result.streak).toEqual({
      start: "2026-07-12",
      through: "2026-07-14",
    });
    expect(streakDays(result.streak!)).toBe(3);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalledOnce();
  });

  it("includes today only after the first completed scrobble", async () => {
    const snapshot: ActivitySnapshot = {
      username: "listener",
      counts: {
        "2026-07-13": 1,
        "2026-07-14": 1,
        "2026-07-15": 1,
      },
      fetchedThrough: Date.parse("2026-07-15T08:00:00Z") / 1000,
      updatedAt: Date.parse("2026-07-15T08:00:00Z") / 1000,
    };
    const store: ActivityStore = {
      get: vi.fn().mockResolvedValue(snapshot),
      put: vi.fn(),
    };

    const result = await loadActivity({
      username: "listener",
      apiKey: "secret",
      store,
      fetcher: vi.fn<typeof fetch>(),
      now: new Date("2026-07-15T09:00:00Z"),
      includeStreak: true,
    });

    expect(result.streak).toEqual({
      start: "2026-07-13",
      through: "2026-07-15",
    });
    expect(streakDays(result.streak!)).toBe(3);
  });

  it("backfills beyond the heatmap only when all 53 weeks are active", async () => {
    const counts: Record<string, number> = {};
    for (
      let date = new Date("2025-07-13T00:00:00Z");
      date <= new Date("2026-07-14T00:00:00Z");
      date = new Date(date.getTime() + 86_400_000)
    ) {
      counts[date.toISOString().slice(0, 10)] = 1;
    }
    const snapshot: ActivitySnapshot = {
      username: "listener",
      counts,
      fetchedThrough: Date.parse("2026-07-15T00:00:00Z") / 1000,
      updatedAt: Date.parse("2026-07-15T00:00:00Z") / 1000,
    };
    const store: ActivityStore = {
      get: vi.fn().mockResolvedValue(snapshot),
      put: vi.fn(),
    };
    const olderActiveDay = Date.parse("2025-07-12T12:00:00Z") / 1000;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        recenttracks: {
          "@attr": { totalPages: "1" },
          track: [{ date: { uts: String(olderActiveDay) } }],
        },
      }),
    );

    const result = await loadActivity({
      username: "listener",
      apiKey: "secret",
      store,
      fetcher,
      now: new Date("2026-07-15T01:00:00Z"),
      includeStreak: true,
    });

    expect(result.streak).toEqual({
      start: "2025-07-12",
      through: "2026-07-14",
    });
    expect(streakDays(result.streak!)).toBe(368);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("replaces an older streak boundary after a new completed gap", async () => {
    const snapshot: ActivitySnapshot = {
      username: "listener",
      counts: {
        "2026-07-12": 1,
        "2026-07-14": 1,
      },
      fetchedThrough: Date.parse("2026-07-15T00:00:00Z") / 1000,
      updatedAt: Date.parse("2026-07-14T00:00:00Z") / 1000,
      streak: { start: "2024-01-01", through: "2026-07-12" },
    };
    const store: ActivityStore = {
      get: vi.fn().mockResolvedValue(snapshot),
      put: vi.fn(),
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
      now: new Date("2026-07-15T01:00:00Z"),
      includeStreak: true,
    });

    expect(result.streak).toEqual({
      start: "2026-07-14",
      through: "2026-07-14",
    });
    expect(streakDays(result.streak!)).toBe(1);
  });
});
