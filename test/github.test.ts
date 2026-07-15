import { describe, expect, it, vi } from "vitest";
import { fetchContributionCounts, loadGithubActivity } from "../src/github";
import type { ActivitySnapshot, ActivityStore } from "../src/types";

function githubResponse(
  days: Array<{ date: string; contributionCount: number }>,
): Response {
  return Response.json({
    data: {
      user: {
        contributionsCollection: {
          contributionCalendar: {
            weeks: [{ contributionDays: days }],
          },
        },
      },
    },
  });
}

function memoryStore(): ActivityStore {
  const values = new Map<string, ActivitySnapshot>();
  return {
    get: vi.fn(async (key) => values.get(key) ?? null),
    put: vi.fn(async (key, value) => {
      values.set(key, value);
    }),
  };
}

describe("GitHub activity", () => {
  it("uses exact GraphQL contribution dates and counts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      githubResponse([
        { date: "2026-07-14", contributionCount: 3 },
        { date: "2026-07-15", contributionCount: 8 },
      ]),
    );
    const counts = await fetchContributionCounts({
      username: "octocat",
      token: "secret",
      from: new Date("2026-07-14T00:00:00Z"),
      to: new Date("2026-07-15T12:00:00Z"),
      fetcher,
    });

    expect(counts).toEqual({ "2026-07-14": 3, "2026-07-15": 8 });
    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer secret",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.variables.login).toBe("octocat");
    expect(body.query).toContain("contributionCount");
  });

  it("splits the 53-week heatmap around GitHub's one-year maximum", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(githubResponse([])));
    await fetchContributionCounts({
      username: "octocat",
      token: "secret",
      from: new Date("2025-07-13T00:00:00Z"),
      to: new Date("2026-07-15T12:00:00Z"),
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(firstBody.variables.to).toBe("2026-07-12T23:59:59.999Z");
  });

  it("maps missing users and rate limits to useful statuses", async () => {
    const missing = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { user: null } }));
    await expect(
      fetchContributionCounts({
        username: "missing",
        token: "secret",
        from: new Date("2026-07-14T00:00:00Z"),
        to: new Date("2026-07-15T00:00:00Z"),
        fetcher: missing,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const limited = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      fetchContributionCounts({
        username: "octocat",
        token: "secret",
        from: new Date("2026-07-14T00:00:00Z"),
        to: new Date("2026-07-15T00:00:00Z"),
        fetcher: limited,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("uses the same today-or-yesterday streak semantics", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(
        githubResponse([
          { date: "2026-07-13", contributionCount: 1 },
          { date: "2026-07-14", contributionCount: 2 },
          { date: "2026-07-15", contributionCount: 0 },
        ]),
      ),
    );
    const snapshot = await loadGithubActivity({
      username: "octocat",
      token: "secret",
      store: memoryStore(),
      fetcher,
      now: new Date("2026-07-15T12:00:00Z"),
      includeStreak: true,
    });

    expect(snapshot.streak).toEqual({
      start: "2026-07-13",
      through: "2026-07-14",
    });
  });
});
