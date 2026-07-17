import { describe, expect, it } from "vitest";
import { renderActivitySvg, renderErrorSvg } from "../src/svg";

describe("SVG rendering", () => {
  it("renders an embeddable, adaptive 53-week graph", () => {
    const svg = renderActivitySvg(
      {
        username: "listener & friends",
        counts: { "2026-07-15": 12 },
        fetchedThrough: 0,
        updatedAt: 0,
      },
      { now: new Date("2026-07-15T18:00:00Z") },
    );

    expect(svg).toContain("listener &amp; friends's Last.fm activity");
    expect(svg).toContain('data-date="2026-07-15" data-count="12"');
    expect(svg).toContain("12 scrobbles in the last year");
    expect(svg).toContain("grouped by America/Los_Angeles date");
    expect(svg).toContain('<text x="560" y="126">last.fm</text>');
    expect(svg).toContain("@media (prefers-color-scheme: dark)");
    expect(svg).toContain(".level-0 { fill: #eeeeee; }");
    expect(svg).toContain(".level-1 { fill: #ff9191; }");
    expect(svg).toContain(".level-4 { fill: #bf3636; }");
    expect(svg).toContain(".level-0 { fill: #111111; }");
    expect(svg).toContain(".level-1 { fill: #ad3f3f; }");
    expect(svg).toContain(".level-4 { fill: #ff8f8f; }");
    expect(svg).toContain('<text x="0" y="44">Mon</text>');
    expect(svg).toContain('<text x="706" y="126">More</text>');
    expect(svg.match(/<rect class="day level-/g)).toHaveLength(373);
  });

  it("escapes error messages", () => {
    expect(renderErrorSvg("bad <value>")).toContain("bad &lt;value&gt;");
  });

  it("renders GitHub copy and rshah-style green palettes", () => {
    const svg = renderActivitySvg(
      {
        username: "octocat",
        counts: { "2026-07-15": 4 },
        fetchedThrough: 0,
        updatedAt: 0,
      },
      { source: "github", now: new Date("2026-07-15T18:00:00Z") },
    );

    expect(svg).toContain("octocat's GitHub activity");
    expect(svg).toContain("4 contributions in the last year");
    expect(svg).toContain('<text x="560" y="126">github</text>');
    expect(svg).toContain(".level-1 { fill: #c6e48b; }");
    expect(svg).toContain(".level-4 { fill: #196127; }");
    expect(svg).toContain(".level-1 { fill: #0e4429; }");
    expect(svg).toContain(".level-4 { fill: #39d353; }");
  });

  it("renders a fixed dark theme for raster output", () => {
    const svg = renderActivitySvg(
      {
        username: "listener",
        counts: {},
        fetchedThrough: 0,
        updatedAt: 0,
      },
      { now: new Date("2026-07-15T18:00:00Z"), theme: "dark" },
    );

    expect(svg).not.toContain("@media (prefers-color-scheme: dark)");
    expect(svg).toContain("text { font: 10px Inter");
    expect(svg).toContain("fill: #8c959f;");
    expect(svg).toContain(".level-0 { fill: #111111; }");
    expect(svg).toContain(".level-4 { fill: #ff8f8f; }");
    expect(svg).not.toContain(".level-0 { fill: #eeeeee; }");
  });

  it("removes the footer in dates display", () => {
    const svg = renderActivitySvg(
      {
        username: "listener",
        counts: {},
        fetchedThrough: 0,
        updatedAt: 0,
      },
      { now: new Date("2026-07-15T18:00:00Z"), display: "dates" },
    );

    expect(svg).toContain('width="734" height="112"');
    expect(svg).toContain(">Mon</text>");
    expect(svg).toContain(">Jul</text>");
    expect(svg).not.toContain("scrobbles in the last year</text>");
    expect(svg).not.toContain(">last.fm</text>");
    expect(svg.match(/<rect class="day level-/g)).toHaveLength(368);
  });

  it("tightly crops minimal display to the tile grid", () => {
    const svg = renderActivitySvg(
      {
        username: "listener",
        counts: {},
        fetchedThrough: 0,
        updatedAt: 0,
      },
      { now: new Date("2026-07-15T18:00:00Z"), display: "minimal" },
    );

    expect(svg).toContain('width="686" height="88"');
    expect(svg).toContain('x="0" y="0" width="10" height="10"');
    expect(svg).not.toContain("<text ");
    expect(svg.match(/<rect class="day level-/g)).toHaveLength(368);
  });
});
