const DAY_SECONDS = 86_400;
const DAY_MS = DAY_SECONDS * 1000;

export interface CalendarRange {
  start: Date;
  end: Date;
  startUnix: number;
}

export interface CalendarTotal {
  total: number;
  from: string;
  to: string;
}

export function getCalendarRange(now: Date): CalendarRange {
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7);

  return {
    start,
    end,
    startUnix: Math.floor(start.getTime() / 1000),
  };
}

export function getCalendarTotal(
  counts: Record<string, number>,
  now: Date,
): CalendarTotal {
  const { start, end } = getCalendarRange(now);
  const from = dateKey(start);
  const to = dateKey(end);
  let total = 0;

  for (const [date, count] of Object.entries(counts)) {
    if (date >= from && date <= to) total += count;
  }

  return { total, from, to };
}

export function toDateKey(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function unixNow(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
