import { describe, expect, it } from "vitest";
import { getCalendarRange, toDateKey } from "../src/dates";

describe("calendar dates", () => {
  it("starts on Sunday 52 weeks before the current week", () => {
    const range = getCalendarRange(new Date("2026-07-15T18:30:00Z"));

    expect(range.start.toISOString()).toBe("2025-07-13T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  it("groups timestamps by UTC date", () => {
    expect(toDateKey(Date.parse("2026-07-15T23:59:59Z") / 1000)).toBe(
      "2026-07-15",
    );
  });
});
