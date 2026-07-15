import { addUtcDays, getCalendarRange } from "./dates";
import type { ActivitySnapshot, ActivitySource } from "./types";

const FULL_WIDTH = 734;
const FULL_HEIGHT = 132;
const CELL = 10;
const GAP = 3;
const LABELED_GRID_X = 32;
const LABELED_GRID_Y = 22;
const GRID_WIDTH = 53 * CELL + 52 * GAP;
const GRID_HEIGHT = 7 * CELL + 6 * GAP;
export type GraphTheme = "light" | "dark";
export type GraphDisplay = "full" | "dates" | "minimal";

interface HeatmapPresentation {
  name: string;
  activityName: string;
  unit: string;
  units: string;
  attribution: string;
  lightColors: string[];
  darkColors: string[];
}

const PRESENTATIONS: Record<ActivitySource, HeatmapPresentation> = {
  lastfm: {
    name: "Last.fm",
    activityName: "Last.fm activity",
    unit: "scrobble",
    units: "scrobbles",
    attribution: "last.fm",
    lightColors: ["#eeeeee", "#ff9191", "#ff7777", "#ef4444", "#bf3636"],
    darkColors: ["#111111", "#ad3f3f", "#d64e4e", "#ff7272", "#ff8f8f"],
  },
  github: {
    name: "GitHub",
    activityName: "GitHub activity",
    unit: "contribution",
    units: "contributions",
    attribution: "github",
    lightColors: ["#eeeeee", "#c6e48b", "#7bc96f", "#239a3b", "#196127"],
    darkColors: ["#111111", "#0e4429", "#006d32", "#26a641", "#39d353"],
  },
};

export interface RenderActivityOptions {
  source?: ActivitySource;
  now?: Date;
  theme?: GraphTheme;
  display?: GraphDisplay;
}

export function renderActivitySvg(
  snapshot: ActivitySnapshot,
  options: RenderActivityOptions = {},
): string {
  const {
    source = "lastfm",
    now = new Date(),
    theme,
    display = "full",
  } = options;
  const presentation = PRESENTATIONS[source];
  const { start, end } = getCalendarRange(now);
  const levels = getThresholds(Object.values(snapshot.counts));
  const total = Object.values(snapshot.counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const cells: string[] = [];
  const minimal = display === "minimal";
  const gridX = minimal ? 0 : LABELED_GRID_X;
  const gridY = minimal ? 0 : LABELED_GRID_Y;
  const width = minimal ? GRID_WIDTH : FULL_WIDTH;
  const height =
    display === "full"
      ? FULL_HEIGHT
      : minimal
        ? GRID_HEIGHT
        : LABELED_GRID_Y + GRID_HEIGHT + 2;

  for (let offset = 0; offset < 53 * 7; offset += 1) {
    const date = addUtcDays(start, offset);
    if (date > end) break;
    const dateKey = date.toISOString().slice(0, 10);
    const count = snapshot.counts[dateKey] ?? 0;
    const week = Math.floor(offset / 7);
    const weekday = offset % 7;
    const level = getLevel(count, levels);
    cells.push(
      `<rect class="day level-${level}" x="${gridX + week * (CELL + GAP)}" y="${gridY + weekday * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="2" data-date="${dateKey}" data-count="${count}"><title>${count} ${count === 1 ? presentation.unit : presentation.units} on ${formatDate(date)}</title></rect>`,
    );
  }

  const colors =
    theme === "dark" ? presentation.darkColors : presentation.lightColors;
  const textColor = theme === "dark" ? "#8c959f" : "#57606a";
  const stroke =
    theme === "dark" ? "rgba(240,246,252,.1)" : "rgba(27,31,36,.06)";
  const adaptiveDarkStyles = theme
    ? ""
    : `
    @media (prefers-color-scheme: dark) {
      text { fill: #8c959f; }
      .day { stroke: rgba(240,246,252,.1); }
      ${presentation.darkColors.map((color, index) => `.level-${index} { fill: ${color}; }`).join("\n      ")}
    }`;
  const dateLabels = minimal
    ? ""
    : `${renderMonthLabels(start, gridX)}
  <text x="0" y="${gridY + (CELL + GAP) + 9}">Mon</text>
  <text x="0" y="${gridY + 3 * (CELL + GAP) + 9}">Wed</text>
  <text x="0" y="${gridY + 5 * (CELL + GAP) + 9}">Fri</text>`;
  const footer =
    display === "full"
      ? `<text x="${gridX}" y="126">${total.toLocaleString("en-US")} ${presentation.units} in the last year</text>
  <text x="560" y="126">${presentation.attribution}</text>
  <text x="613" y="126">Less</text>
  ${colors.map((_, index) => `<rect class="day level-${index}" x="${641 + index * 13}" y="117" width="10" height="10" rx="2"/>`).join("\n  ")}
  <text x="706" y="126">More</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(snapshot.username)}'s ${presentation.activityName}</title>
  <desc id="desc">${total.toLocaleString("en-US")} ${presentation.units} over the last year, grouped by UTC date.</desc>
  <style>
    text { font: 10px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${textColor}; }
    .day { shape-rendering: geometricPrecision; stroke: ${stroke}; stroke-width: 1px; }
    ${colors.map((color, index) => `.level-${index} { fill: ${color}; }`).join("\n    ")}${adaptiveDarkStyles}
  </style>
  ${dateLabels}
  ${cells.join("\n  ")}
  ${footer}
</svg>`;
}

export function renderErrorSvg(
  message: string,
  source: ActivitySource = "lastfm",
): string {
  const name = PRESENTATIONS[source].name;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="734" height="132" viewBox="0 0 734 132" role="img" aria-label="${name} graph error">
  <rect width="734" height="132" rx="6" fill="#fff" stroke="#d0d7de"/>
  <text x="367" y="62" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="14" fill="#1f2328">Could not load ${name} activity</text>
  <text x="367" y="84" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="11" fill="#636c76">${escapeXml(message)}</text>
</svg>`;
}

function renderMonthLabels(start: Date, gridX: number): string {
  const labels: string[] = [];
  let previousMonth = -1;
  for (let week = 0; week < 53; week += 1) {
    const date = addUtcDays(start, week * 7);
    const month = date.getUTCMonth();
    if (month !== previousMonth && date.getUTCDate() <= 7) {
      labels.push(
        `<text x="${gridX + week * (CELL + GAP)}" y="12">${date.toLocaleString("en-US", { month: "short", timeZone: "UTC" })}</text>`,
      );
    }
    previousMonth = month;
  }
  return labels.join("\n  ");
}

function getThresholds(values: number[]): [number, number, number] {
  const nonzero = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return [1, 2, 3];
  return [0.25, 0.5, 0.75].map(
    (quantile) => nonzero[Math.floor((nonzero.length - 1) * quantile)] ?? 1,
  ) as [number, number, number];
}

function getLevel(
  count: number,
  [low, medium, high]: [number, number, number],
): number {
  if (count === 0) return 0;
  if (count <= low) return 1;
  if (count <= medium) return 2;
  if (count <= high) return 3;
  return 4;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] ?? character;
  });
}
