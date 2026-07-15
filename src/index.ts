import { loadActivity, LastfmError } from "./lastfm";
import { renderActivitySvg, renderErrorSvg } from "./svg";
import type { GraphDisplay, GraphTheme } from "./svg";
import type {
  ActivitySnapshot,
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
const IMAGE_CACHE_VERSION = 7;

type Output =
  | { format: "svg"; display: GraphDisplay }
  | { format: "png"; theme: GraphTheme; display: GraphDisplay };

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
    const parsed = parseOutput(path, url.searchParams);
    if (parsed instanceof Response) return parsed;
    const { username, output } = parsed;
    if (!isValidUsername(username)) {
      return svgResponse(renderErrorSvg("Invalid Last.fm username"), 400, 60);
    }

    const cache =
      dependencies.edgeCache ??
      (caches as CacheStorage & { default: Cache }).default;
    const cacheKey = new Request(
      `${url.origin}/__lastfm-heatmap-cache/v${IMAGE_CACHE_VERSION}/${output.format}/${output.format === "png" ? output.theme : "adaptive"}/${output.display}/${encodeURIComponent(username)}`,
    );
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return request.method === "HEAD"
        ? new Response(null, cachedResponse)
        : cachedResponse;
    }

    if (!env.LASTFM_API_KEY) {
      return svgResponse(
        renderErrorSvg("Server is missing LASTFM_API_KEY"),
        500,
        0,
      );
    }

    try {
      const snapshot = await loadActivity({
        username,
        apiKey: env.LASTFM_API_KEY,
        store: kvStore(env.ACTIVITY_CACHE),
        fetcher: dependencies.fetcher,
        now: dependencies.now?.(),
      });
      const svg = renderActivitySvg(
        snapshot,
        dependencies.now?.(),
        output.format === "png" ? output.theme : undefined,
        output.display,
      );
      const response = await imageResponse(
        svg,
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
      const status = error instanceof LastfmError ? error.status : 500;
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      return svgResponse(
        renderErrorSvg(message),
        status,
        status === 429 ? 60 : 300,
      );
    }
  };
}

function parseOutput(
  path: string,
  searchParams: URLSearchParams,
): { username: string; output: Output } | Response {
  const display = searchParams.get("display") ?? "full";
  if (display !== "full" && display !== "dates" && display !== "minimal") {
    return new Response("display must be full, dates, or minimal", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!path.endsWith(".png")) {
    return {
      username: path.endsWith(".svg") ? path.slice(0, -4) : path,
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
    username: path.slice(0, -4),
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

function isValidUsername(username: string): boolean {
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

async function imageResponse(
  svg: string,
  output: Output,
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
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Last.fm Heatmap</title><style>body{max-width:760px;margin:10vh auto;padding:24px;font:16px/1.5 system-ui;color:#1f2328}code{background:#f6f8fa;padding:.2em .4em;border-radius:4px}</style><h1>Last.fm Heatmap</h1><p>Embeddable GitHub-style activity heatmaps for Last.fm.</p><pre><code>&lt;img src="${escapedOrigin}/YOUR_USERNAME" alt="Last.fm activity"&gt;</code></pre><p>Adaptive SVG: <code>/YOUR_USERNAME</code> or <code>/YOUR_USERNAME.svg</code></p><p>Social PNG: <code>/YOUR_USERNAME.png?theme=light</code> or <code>/YOUR_USERNAME.png?theme=dark</code></p><p>Display: <code>?display=full</code>, <code>?display=dates</code>, or <code>?display=minimal</code></p><p>Dates are grouped in UTC. Data provided by <a href="https://www.last.fm/">Last.fm</a>.</p></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
