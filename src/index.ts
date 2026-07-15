import { GithubError, loadGithubActivity } from "./github";
import { loadActivity, LastfmError, streakDays } from "./lastfm";
import { renderActivitySvg, renderErrorSvg } from "./svg";
import type { GraphDisplay, GraphTheme } from "./svg";
import type {
  ActivitySnapshot,
  ActivitySource,
  ActivityStore,
  Env,
  ExecutionContextLike,
} from "./types";

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};
const PNG_HEADERS = {
  "Content-Type": "image/png",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "X-Content-Type-Options": "nosniff",
};
const CACHE_VERSION = 9;

type Output =
  | { format: "svg"; display: GraphDisplay }
  | {
      format: "png";
      theme: GraphTheme;
      display: GraphDisplay;
    }
  | { format: "streak" };

interface ParsedRequest {
  source: ActivitySource;
  username: string;
  output: Output;
}

export interface HandlerDependencies {
  fetcher?: typeof fetch;
  now?: () => Date;
  edgeCache?: Pick<Cache, "match" | "put">;
  rasterize?: (svg: string) => Promise<Uint8Array>;
}

export function createHandler(dependencies: HandlerDependencies = {}) {
  return async function handle(
    request: Request,
    env: Env,
    context: ExecutionContextLike,
  ): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.slice(1)).trim();
    if (!path) return landingPage(url.origin);
    const parsed = parseRequest(path, url.searchParams);
    if (parsed instanceof Response) return parsed;
    const { source, username, output } = parsed;
    if (!isValidUsername(source, username)) {
      return errorResponse(
        source,
        output,
        `Invalid ${source === "github" ? "GitHub" : "Last.fm"} username`,
        400,
        60,
      );
    }

    const cache =
      dependencies.edgeCache ??
      (caches as CacheStorage & { default: Cache }).default;
    const cacheKey = new Request(
      `${url.origin}/__heatmaps-cache/v${CACHE_VERSION}/${source}/${cachePath(output)}/${encodeURIComponent(username.toLowerCase())}`,
    );
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return request.method === "HEAD"
        ? new Response(null, cachedResponse)
        : cachedResponse;
    }

    const missingSecret =
      source === "github" ? !env.GITHUB_TOKEN : !env.LASTFM_API_KEY;
    if (missingSecret) {
      const secret = source === "github" ? "GITHUB_TOKEN" : "LASTFM_API_KEY";
      return errorResponse(
        source,
        output,
        `Server is missing ${secret}`,
        500,
        0,
      );
    }

    try {
      const now = dependencies.now?.();
      const store = kvStore(env.ACTIVITY_CACHE);
      const snapshot =
        source === "github"
          ? await loadGithubActivity({
              username,
              token: env.GITHUB_TOKEN,
              store,
              fetcher: dependencies.fetcher,
              now,
              includeStreak: output.format === "streak",
            })
          : await loadActivity({
              username,
              apiKey: env.LASTFM_API_KEY,
              store,
              fetcher: dependencies.fetcher,
              now,
              includeStreak: output.format === "streak",
            });
      const response =
        output.format === "streak"
          ? jsonResponse(
              { streak: streakDays(snapshot.streak!) },
              200,
              6 * 60 * 60,
            )
          : await imageResponse(
              renderActivitySvg(snapshot, {
                source,
                now,
                theme: output.format === "png" ? output.theme : undefined,
                display: output.display,
              }),
              output,
              200,
              6 * 60 * 60,
              dependencies.rasterize,
            );
      context.waitUntil(cache.put(cacheKey, response.clone()));
      return request.method === "HEAD"
        ? new Response(null, response)
        : response;
    } catch (error) {
      const status =
        error instanceof LastfmError || error instanceof GithubError
          ? error.status
          : 500;
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      return errorResponse(
        source,
        output,
        message,
        status,
        status === 429 ? 60 : 300,
      );
    }
  };
}

function parseRequest(
  path: string,
  searchParams: URLSearchParams,
): ParsedRequest | Response {
  const segments = path.split("/");
  const explicitSource = segments[0] === "lastfm" || segments[0] === "github";
  const source: ActivitySource = explicitSource
    ? (segments.shift() as ActivitySource)
    : "lastfm";
  let resource = segments.join("/");

  if (resource.endsWith("/streak")) {
    return {
      source,
      username: resource.slice(0, -"/streak".length),
      output: { format: "streak" },
    };
  }

  const display = searchParams.get("display") ?? "full";
  if (display !== "full" && display !== "dates" && display !== "minimal") {
    return new Response("display must be full, dates, or minimal", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!resource.endsWith(".png")) {
    if (resource.endsWith(".svg")) resource = resource.slice(0, -4);
    return {
      source,
      username: resource,
      output: { format: "svg", display },
    };
  }

  const theme = searchParams.get("theme");
  if (theme !== "light" && theme !== "dark") {
    return new Response("PNG requests require ?theme=light or ?theme=dark", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return {
    source,
    username: resource.slice(0, -4),
    output: { format: "png", theme, display },
  };
}

const handle = createHandler();

export default {
  fetch(
    request: Request,
    env: Env,
    context: ExecutionContext,
  ): Promise<Response> {
    return handle(request, env, context);
  },
};

function kvStore(namespace: KVNamespace): ActivityStore {
  return {
    get(key) {
      return namespace.get<ActivitySnapshot>(key, "json");
    },
    put(key, value) {
      return namespace.put(key, JSON.stringify(value), {
        expirationTtl: 400 * 24 * 60 * 60,
      });
    },
  };
}

function isValidUsername(source: ActivitySource, username: string): boolean {
  if (source === "github") {
    return (
      username.length <= 39 &&
      /^(?!-)(?!.*--)[A-Za-z0-9-]+(?<!-)$/.test(username)
    );
  }
  return username.length <= 64 && /^[\p{L}\p{N}_. -]+$/u.test(username);
}

function svgResponse(svg: string, status: number, maxAge: number): Response {
  return new Response(svg, {
    status,
    headers: {
      ...SVG_HEADERS,
      "Cache-Control": `public, max-age=300, s-maxage=${maxAge}`,
    },
  });
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  maxAge: number,
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...JSON_HEADERS,
      "Cache-Control": `public, max-age=300, s-maxage=${maxAge}`,
    },
  });
}

function errorResponse(
  source: ActivitySource,
  output: Output,
  message: string,
  status: number,
  maxAge: number,
): Response {
  return output.format === "streak"
    ? jsonResponse({ error: message }, status, maxAge)
    : svgResponse(renderErrorSvg(message, source), status, maxAge);
}

function cachePath(output: Output): string {
  if (output.format === "streak") return "streak";
  return `${output.format}/${output.format === "png" ? output.theme : "adaptive"}/${output.display}`;
}

async function imageResponse(
  svg: string,
  output: Exclude<Output, { format: "streak" }>,
  status: number,
  maxAge: number,
  rasterize = defaultRasterize,
): Promise<Response> {
  if (output.format === "svg") return svgResponse(svg, status, maxAge);

  const png = await rasterize(svg);
  const body = png.buffer.slice(
    png.byteOffset,
    png.byteOffset + png.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status,
    headers: {
      ...PNG_HEADERS,
      "Cache-Control": `public, max-age=300, s-maxage=${maxAge}`,
    },
  });
}

async function defaultRasterize(svg: string): Promise<Uint8Array> {
  const { renderPng } = await import("./png");
  return renderPng(svg);
}

function landingPage(origin: string): Response {
  const escapedOrigin = origin.replace(/[<>&"']/g, "");
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Heatmaps</title><style>body{max-width:760px;margin:10vh auto;padding:24px;font:16px/1.5 system-ui;color:#1f2328}code{background:#f6f8fa;padding:.2em .4em;border-radius:4px}</style><h1>Heatmaps</h1><p>Embeddable activity heatmaps for Last.fm and GitHub.</p><pre><code>&lt;img src="${escapedOrigin}/lastfm/YOUR_USERNAME" alt="Last.fm activity"&gt;\n&lt;img src="${escapedOrigin}/github/YOUR_USERNAME" alt="GitHub activity"&gt;</code></pre><p>Use <code>.svg</code> for an explicit SVG, <code>.png?theme=light</code> or <code>.png?theme=dark</code> for social images, and <code>/streak</code> for streak JSON.</p><p>Display: <code>?display=full</code>, <code>?display=dates</code>, or <code>?display=minimal</code>.</p></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
