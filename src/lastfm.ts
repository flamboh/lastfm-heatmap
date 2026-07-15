import { getCalendarRange, toDateKey, unixNow } from "./dates";
import type { ActivitySnapshot, ActivityStore } from "./types";

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const PAGE_SIZE = 200;
const CONCURRENCY = 6;
const FRESH_FOR_SECONDS = 6 * 60 * 60;
const MAX_PAGES = 500;
const REFRESH_OVERLAP_SECONDS = 2 * 86_400;

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
}

export async function loadActivity({
  username,
  apiKey,
  store,
  fetcher = fetch,
  now = new Date(),
}: LoadActivityOptions): Promise<ActivitySnapshot> {
  const cacheKey = `activity:v1:${username.toLowerCase()}`;
  const cached = await store.get(cacheKey);
  const currentUnix = unixNow(now);

  if (cached && currentUnix - cached.updatedAt < FRESH_FOR_SECONDS) {
    return cached;
  }

  const range = getCalendarRange(now);
  const from = cached
    ? Math.max(
        range.startUnix,
        Math.floor((cached.fetchedThrough - REFRESH_OVERLAP_SECONDS) / 86_400) *
          86_400,
      )
    : range.startUnix;
  const newCounts = await fetchDailyCounts({
    username,
    apiKey,
    from,
    to: currentUnix,
    fetcher,
  });

  const counts: Record<string, number> = {};
  const rangeStart = range.start.toISOString().slice(0, 10);
  const refreshStart = toDateKey(from);
  for (const [date, count] of Object.entries(cached?.counts ?? {})) {
    if (date >= rangeStart && date < refreshStart) counts[date] = count;
  }
  for (const [date, count] of Object.entries(newCounts)) {
    counts[date] = (counts[date] ?? 0) + count;
  }

  const snapshot: ActivitySnapshot = {
    username,
    counts,
    fetchedThrough: currentUnix,
    updatedAt: currentUnix,
  };
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

export async function fetchDailyCounts({
  username,
  apiKey,
  from,
  to,
  fetcher,
}: FetchDailyCountsOptions): Promise<Record<string, number>> {
  if (from > to) return {};

  const first = await fetchPage({
    username,
    apiKey,
    from,
    to,
    page: 1,
    fetcher,
  });
  const totalPages = Number(first.recenttracks?.["@attr"]?.totalPages ?? 1);

  if (!Number.isFinite(totalPages) || totalPages < 1) {
    throw new LastfmError("Last.fm returned invalid pagination data");
  }
  if (totalPages > MAX_PAGES) {
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

  return counts;
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
    headers: { "User-Agent": "lastfm-heatmap/0.1 (+https://github.com/)" },
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
