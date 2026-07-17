import { describe, expect, it } from "vitest";
import { dateKeyUnix, getCalendarRange, toDateKey } from "../src/dates";

describe("calendar dates", () => {
  it("starts on Sunday 52 weeks before the current week", () => {
    const range = getCalendarRange(new Date("2026-07-15T06:30:00Z"));

    expect(range.start.toISOString()).toBe("2025-07-13T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-14T00:00:00.000Z");
    expect(range.startUnix).toBe(Date.parse("2025-07-13T07:00:00Z") / 1000);
  });

  it("groups timestamps by Los Angeles date", () => {
    expect(toDateKey(Date.parse("2026-07-15T06:59:59Z") / 1000)).toBe(
      "2026-07-14",
    );
    expect(toDateKey(Date.parse("2026-07-15T07:00:00Z") / 1000)).toBe(
      "2026-07-15",
    );
  });

  it("converts local midnight using the daylight-saving offset", () => {
    expect(dateKeyUnix("2026-01-15")).toBe(
      Date.parse("2026-01-15T08:00:00Z") / 1000,
    );
    expect(dateKeyUnix("2026-07-15")).toBe(
      Date.parse("2026-07-15T07:00:00Z") / 1000,
    );
  });
});
