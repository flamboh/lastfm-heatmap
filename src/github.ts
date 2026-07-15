import { addUtcDays, getCalendarRange, unixNow } from "./dates";
import type { ActivitySnapshot, ActivityStore, ActivityStreak } from "./types";

const API_URL = "https://api.github.com/graphql";
const FRESH_FOR_SECONDS = 6 * 60 * 60;
const MAX_RANGE_DAYS = 365;
const MAX_STREAK_BACKFILLS = 10;

interface GithubResponse {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          weeks?: Array<{
            contributionDays?: Array<{
              date?: string;
              contributionCount?: number;
            }>;
          }>;
        };
      };
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

interface GithubOptions {
  username: string;
  token: string;
  fetcher: typeof fetch;
}

export async function loadGithubActivity({
  username,
  token,
  store,
  fetcher = fetch,
  now = new Date(),
  includeStreak = false,
}: Omit<GithubOptions, "fetcher"> & {
  store: ActivityStore;
  fetcher?: typeof fetch;
  now?: Date;
  includeStreak?: boolean;
}): Promise<ActivitySnapshot> {
  const cacheKey = `github:activity:v1:${username.toLowerCase()}`;
  const cached = await store.get(cacheKey);
  const currentUnix = unixNow(now);
  const fresh = cached && currentUnix - cached.updatedAt < FRESH_FOR_SECONDS;
  if (fresh && (!includeStreak || cached.streak)) return cached;

  const range = getCalendarRange(now);
  const counts = fresh
    ? cached.counts
    : await fetchContributionCounts({
        username,
        token,
        fetcher,
        from: range.start,
        to: now,
      });
  const snapshot: ActivitySnapshot = {
    username,
    counts,
    fetchedThrough: currentUnix,
    updatedAt: currentUnix,
  };
  if (includeStreak || cached?.streak) {
    snapshot.streak = await resolveStreak({
      username,
      token,
      fetcher,
      now,
      counts,
      rangeStart: dateKey(range.start),
      previous: cached?.streak,
    });
  }
  await store.put(cacheKey, snapshot);
  return snapshot;
}

export async function fetchContributionCounts({
  username,
  token,
  fetcher,
  from,
  to,
}: GithubOptions & { from: Date; to: Date }): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (let start = startOfUtcDay(from); start <= to;) {
    const lastDay = addUtcDays(start, MAX_RANGE_DAYS - 1);
    const finalWindow = lastDay >= to;
    const end = finalWindow
      ? to
      : new Date(addUtcDays(lastDay, 1).getTime() - 1);
    Object.assign(
      counts,
      await fetchWindow({ username, token, fetcher, from: start, to: end }),
    );
    if (finalWindow) break;
    start = addUtcDays(lastDay, 1);
  }
  return counts;
}

async function fetchWindow({
  username,
  token,
  fetcher,
  from,
  to,
}: GithubOptions & { from: Date; to: Date }): Promise<Record<string, number>> {
  const response = await fetcher(API_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "heatmaps-worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      query: `query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks { contributionDays { date contributionCount } }
            }
          }
        }
      }`,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });
  if (!response.ok) {
    const status =
      response.status === 401 ? 500 : response.status === 403 ? 429 : 502;
    throw new GithubError(`GitHub request failed (${response.status})`, status);
  }

  const data = (await response.json()) as GithubResponse;
  if (data.errors?.length) {
    const message = data.errors[0]?.message ?? "GitHub request failed";
    throw new GithubError(message, /rate limit/i.test(message) ? 429 : 502);
  }
  if (data.data?.user === null)
    throw new GithubError("GitHub user not found", 404);
  const weeks =
    data.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new GithubError("GitHub returned an unexpected response");

  const counts: Record<string, number> = {};
  for (const week of weeks) {
    for (const day of week.contributionDays ?? []) {
      if (!day.date || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
      if (!Number.isFinite(day.contributionCount) || day.contributionCount! < 0)
        continue;
      counts[day.date] = day.contributionCount!;
    }
  }
  return counts;
}

async function resolveStreak({
  counts,
  rangeStart,
  previous,
  username,
  token,
  fetcher,
  now,
}: GithubOptions & {
  counts: Record<string, number>;
  rangeStart: string;
  previous?: ActivityStreak;
  now: Date;
}): Promise<ActivityStreak> {
  const today = dateKey(now);
  const through = counts[today] ? today : shiftDateKey(today, -1);
  const recent = findStreakStart(counts, through, rangeStart);
  if (recent !== undefined) return { start: recent, through };
  if (previous?.start && previous.start <= rangeStart)
    return { start: previous.start, through };

  let candidateStart = rangeStart;
  for (let attempt = 0; attempt < MAX_STREAK_BACKFILLS; attempt += 1) {
    const windowEnd = shiftDateKey(candidateStart, -1);
    const windowStart = shiftDateKey(windowEnd, -(MAX_RANGE_DAYS - 1));
    const older = await fetchContributionCounts({
      username,
      token,
      fetcher,
      from: dateFromKey(windowStart),
      to: new Date(addUtcDays(dateFromKey(windowEnd), 1).getTime() - 1),
    });
    const start = findStreakStart(older, windowEnd, windowStart);
    if (start !== undefined) return { start, through };
    candidateStart = windowStart;
  }
  throw new GithubError("Streak history exceeds the safe backfill limit", 422);
}

function findStreakStart(
  counts: Record<string, number>,
  through: string,
  rangeStart: string,
): string | null | undefined {
  for (let date = through; date >= rangeStart; date = shiftDateKey(date, -1)) {
    if (!counts[date]) return date === through ? null : shiftDateKey(date, 1);
  }
  return undefined;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateFromKey(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function shiftDateKey(value: string, days: number): string {
  return dateKey(addUtcDays(dateFromKey(value), days));
}
