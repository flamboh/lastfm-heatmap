const DAY_SECONDS = 86_400;
const DAY_MS = DAY_SECONDS * 1000;

export const CALENDAR_TIME_ZONE = "America/Los_Angeles";

const dateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CALENDAR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

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
  const end = dateFromKey(toDateKey(unixNow(now)));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7);

  return {
    start,
    end,
    startUnix: dateKeyUnix(dateKey(start)),
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
  const parts = dateKeyFormatter.formatToParts(new Date(unixSeconds * 1000));
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

export function dateKeyUnix(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let instant = target;

  // Convert the desired wall-clock midnight to its UTC instant. Iterating
  // handles daylight-saving offset changes without assuming a fixed offset.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateTimeFormatter.formatToParts(new Date(instant));
    const representedAsUtc = Date.UTC(
      Number(part(parts, "year")),
      Number(part(parts, "month")) - 1,
      Number(part(parts, "day")),
      Number(part(parts, "hour")),
      Number(part(parts, "minute")),
      Number(part(parts, "second")),
    );
    instant += target - representedAsUtc;
  }

  return instant / 1000;
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

function dateFromKey(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function part(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((candidate) => candidate.type === type)?.value ?? "";
}
