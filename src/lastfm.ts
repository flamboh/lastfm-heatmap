import {
  addUtcDays,
  dateKeyUnix,
  getCalendarRange,
  toDateKey,
  unixNow,
} from "./dates";
import type { ActivitySnapshot, ActivityStore, ActivityStreak } from "./types";

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const PAGE_SIZE = 200;
const CONCURRENCY = 6;
const FRESH_FOR_SECONDS = 6 * 60 * 60;
const MAX_PAGES = 500;
const REFRESH_OVERLAP_SECONDS = 2 * 86_400;
const STREAK_BACKFILL_DAYS = 32;

interface LastfmTrack {
  date?: { uts?: string };
  "@attr"?: { nowplaying?: string };
}

interface LastfmResponse {
  error?: number;
  message?: string;
  recenttracks?: {
    track?: LastfmTrack[];
    "@attr"?: { totalPages?: string };
  };
}

export class LastfmError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export interface LoadActivityOptions {
  username: string;
  apiKey: string;
  store: ActivityStore;
  fetcher?: typeof fetch;
  now?: Date;
  includeStreak?: boolean;
}

export async function loadActivity({
  username,
  apiKey,
  store,
  fetcher = fetch,
  now = new Date(),
  includeStreak = false,
}: LoadActivityOptions): Promise<ActivitySnapshot> {
  const cacheKey = `activity:v2:${username.toLowerCase()}`;
  const cached = await store.get(cacheKey);
  const currentUnix = unixNow(now);

  const fresh = cached && currentUnix - cached.updatedAt < FRESH_FOR_SECONDS;
  if (fresh && (!includeStreak || cached.streak)) {
    return cached;
  }

  const range = getCalendarRange(now);
  if (fresh) {
    const snapshot = {
      ...cached,
      streak: await resolveStreak({
        counts: cached.counts,
        rangeStart: dateKey(range.start),
        previous: cached.streak,
        username,
        apiKey,
        fetcher,
        now,
        pageBudget: MAX_PAGES,
      }),
    };
    await store.put(cacheKey, snapshot);
    return snapshot;
  }

  const from = cached
    ? Math.max(
        range.startUnix,
        dateKeyUnix(toDateKey(cached.fetchedThrough - REFRESH_OVERLAP_SECONDS)),
      )
    : range.startUnix;
  const fetched = await fetchDailyCountsWithPages({
    username,
    apiKey,
    from,
    to: currentUnix,
    fetcher,
    pageBudget: MAX_PAGES,
  });

  const counts: Record<string, number> = {};
  const rangeStart = range.start.toISOString().slice(0, 10);
  const refreshStart = toDateKey(from);
  for (const [date, count] of Object.entries(cached?.counts ?? {})) {
    if (date >= rangeStart && date < refreshStart) counts[date] = count;
  }
  for (const [date, count] of Object.entries(fetched.counts)) {
    counts[date] = (counts[date] ?? 0) + count;
  }

  const snapshot: ActivitySnapshot = {
    username,
    counts,
    fetchedThrough: currentUnix,
    updatedAt: currentUnix,
  };
  if (includeStreak || cached?.streak) {
    snapshot.streak = await resolveStreak({
      counts,
      rangeStart,
      previous: cached?.streak,
      username,
      apiKey,
      fetcher,
      now,
      pageBudget: MAX_PAGES - fetched.pages,
    });
  }
  await store.put(cacheKey, snapshot);
  return snapshot;
}

interface FetchDailyCountsOptions {
  username: string;
  apiKey: string;
  from: number;
  to: number;
  fetcher: typeof fetch;
}

interface FetchDailyCountsResult {
  counts: Record<string, number>;
  pages: number;
}

export async function fetchDailyCounts({
  username,
  apiKey,
  from,
  to,
  fetcher,
}: FetchDailyCountsOptions): Promise<Record<string, number>> {
  return (
    await fetchDailyCountsWithPages({
      username,
      apiKey,
      from,
      to,
      fetcher,
      pageBudget: MAX_PAGES,
    })
  ).counts;
}

async function fetchDailyCountsWithPages({
  username,
  apiKey,
  from,
  to,
  fetcher,
  pageBudget,
}: FetchDailyCountsOptions & {
  pageBudget: number;
}): Promise<FetchDailyCountsResult> {
  if (from > to) return { counts: {}, pages: 0 };
  if (pageBudget < 1) {
    throw new LastfmError(
      "Streak history exceeds the safe backfill limit",
      422,
    );
  }

  const first = await fetchPage({
    username,
    apiKey,
    from,
    to,
    page: 1,
    fetcher,
  });
  const totalPages = Number(first.recenttracks?.["@attr"]?.totalPages ?? 1);

  if (!Number.isInteger(totalPages) || totalPages < 0) {
    throw new LastfmError("Last.fm returned invalid pagination data");
  }
  if (totalPages > pageBudget) {
    throw new LastfmError(
      `This account has too many scrobbles to backfill safely (${totalPages} pages)`,
      422,
    );
  }

  const counts: Record<string, number> = {};
  addTracks(counts, first.recenttracks?.track ?? []);

  for (let start = 2; start <= totalPages; start += CONCURRENCY) {
    const pages = Array.from(
      { length: Math.min(CONCURRENCY, totalPages - start + 1) },
      (_, index) => start + index,
    );
    const responses = await Promise.all(
      pages.map((page) =>
        fetchPage({ username, apiKey, from, to, page, fetcher }),
      ),
    );
    for (const response of responses) {
      addTracks(counts, response.recenttracks?.track ?? []);
    }
  }

  return { counts, pages: Math.max(1, totalPages) };
}

interface ResolveStreakOptions {
  counts: Record<string, number>;
  rangeStart: string;
  previous?: ActivityStreak;
  username: string;
  apiKey: string;
  fetcher: typeof fetch;
  now: Date;
  pageBudget: number;
}

async function resolveStreak({
  counts,
  rangeStart,
  previous,
  username,
  apiKey,
  fetcher,
  now,
  pageBudget,
}: ResolveStreakOptions): Promise<ActivityStreak> {
  const today = toDateKey(unixNow(now));
  const through = counts[today] ? today : shiftDateKey(today, -1);
  const recent = findStreakStart(counts, through, rangeStart);

  if (recent !== undefined) return { start: recent, through };
  if (previous?.start && previous.start <= rangeStart) {
    return { start: previous.start, through };
  }

  let candidateStart = rangeStart;
  let remainingPages = pageBudget;
  while (remainingPages > 0) {
    const windowEnd = shiftDateKey(candidateStart, -1);
    const windowStart = shiftDateKey(windowEnd, -(STREAK_BACKFILL_DAYS - 1));
    const fetched = await fetchDailyCountsWithPages({
      username,
      apiKey,
      from: dateKeyUnix(windowStart),
      to: dateKeyUnix(shiftDateKey(windowEnd, 1)) - 1,
      fetcher,
      pageBudget: remainingPages,
    });
    remainingPages -= fetched.pages;

    const start = findStreakStart(fetched.counts, windowEnd, windowStart);
    if (start !== undefined) return { start, through };
    candidateStart = windowStart;
  }

  throw new LastfmError("Streak history exceeds the safe backfill limit", 422);
}

// Returns undefined when every day in the inspected range is active.
function findStreakStart(
  counts: Record<string, number>,
  through: string,
  rangeStart: string,
): string | null | undefined {
  for (let date = through; date >= rangeStart; date = shiftDateKey(date, -1)) {
    if (!counts[date]) {
      return date === through ? null : shiftDateKey(date, 1);
    }
  }
  return undefined;
}

export function streakDays(streak: ActivityStreak): number {
  if (!streak.start) return 0;
  return Math.floor(
    (Date.parse(`${streak.through}T00:00:00Z`) -
      Date.parse(`${streak.start}T00:00:00Z`)) /
      86_400_000 +
      1,
  );
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDateKey(value: string, days: number): string {
  return dateKey(addUtcDays(new Date(`${value}T00:00:00Z`), days));
}

function addTracks(
  counts: Record<string, number>,
  tracks: LastfmTrack[],
): void {
  for (const track of tracks) {
    if (track["@attr"]?.nowplaying || !track.date?.uts) continue;
    const timestamp = Number(track.date.uts);
    if (!Number.isFinite(timestamp)) continue;
    const date = toDateKey(timestamp);
    counts[date] = (counts[date] ?? 0) + 1;
  }
}

interface FetchPageOptions extends FetchDailyCountsOptions {
  page: number;
}

async function fetchPage({
  username,
  apiKey,
  from,
  to,
  page,
  fetcher,
}: FetchPageOptions): Promise<LastfmResponse> {
  const url = new URL(API_URL);
  url.searchParams.set("method", "user.getRecentTracks");
  url.searchParams.set("user", username);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("page", String(page));
  // Last.fm defines `from` as exclusive; subtract one second to include midnight.
  url.searchParams.set("from", String(Math.max(0, from - 1)));
  url.searchParams.set("to", String(to));

  const response = await fetcher(url, {
    headers: {
      "User-Agent": "heatmaps/0.1 (+https://github.com/flamboh/heatmaps)",
    },
  });
  if (!response.ok) {
    throw new LastfmError(`Last.fm request failed (${response.status})`);
  }

  const data = (await response.json()) as LastfmResponse;
  if (data.error) {
    const status = data.error === 6 ? 404 : data.error === 29 ? 429 : 502;
    throw new LastfmError(data.message ?? "Last.fm request failed", status);
  }
  if (!data.recenttracks) {
    throw new LastfmError("Last.fm returned an unexpected response");
  }
  return data;
}
