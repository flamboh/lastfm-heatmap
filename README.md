# Last.fm Heatmap

Embeddable GitHub-style activity graphs for Last.fm.

```html
<a href="https://www.last.fm/user/YOUR_USERNAME">
  <img src="https://fm-heat.oli.boo/YOUR_USERNAME" alt="Last.fm activity" />
</a>
```

The public interface is deliberately small:

- `GET /:username` and `GET /:username.svg` return an adaptive SVG.
- `GET /:username.png?theme=light` returns a fixed light PNG.
- `GET /:username.png?theme=dark` returns a fixed dark PNG.

All formats accept a `display` parameter:

- `display=full` is the default and includes dates, totals, attribution, and the
  legend.
- `display=dates` keeps the month and weekday labels but removes the footer.
- `display=minimal` returns only the tightly cropped tile grid.

The graph covers 53 calendar weeks and groups scrobbles by UTC date. Use SVG
for websites and the 2× PNG (1468×264) for Discord or other clients that do not
preview SVGs.

## How it works

- A Cloudflare Worker fetches completed scrobbles through Last.fm's
  `user.getRecentTracks` method.
- Daily aggregates are stored in Workers KV. After the first 53-week backfill,
  refreshes overlap the previous two days and fetch only recent data.
- Rendered SVG and PNG responses are cached at the edge for six hours.
- The Last.fm API key remains an encrypted Worker secret and is never sent to
  visitors.

The initial backfill is capped at 500 Last.fm pages (100,000 scrobbles) per
account. The Worker is configured for the Workers Paid plan because Free is
limited to 50 external subrequests per invocation.

## Deploy

Requirements: Bun 1.3+, a Cloudflare Workers Paid account, and a
[Last.fm API key](https://www.last.fm/api/account/create).

1. Install dependencies:

   ```sh
   bun install
   ```

2. Log in and create the KV namespace:

   ```sh
   bunx wrangler login
   bunx wrangler kv namespace create ACTIVITY_CACHE
   ```

3. Replace the existing `account_id` and KV namespace `id` in `wrangler.jsonc`
   with the values for your Cloudflare account.

4. Add the API key as an encrypted secret:

   ```sh
   bunx wrangler secret put LASTFM_API_KEY
   ```

5. Deploy:

   ```sh
   bun run deploy
   ```

For local development, copy `.dev.vars.example` to `.dev.vars`, add the API
key, and run `bun run dev`. Do not commit `.dev.vars`.

## Verification

```sh
bun run typecheck
bun run lint
bun run test
bun run fmt:check
```

## Operational notes

- Successful graphs are refreshed at most every six hours.
- KV snapshots expire after 400 days of inactivity.
- Last.fm errors are returned as small SVG error cards with appropriate HTTP
  status codes and short cache lifetimes.
- The endpoint allows cross-origin embedding and sends `nosniff`.
- Data is attributed to Last.fm on the landing page. Deployers should review
  the [Last.fm API Terms of Service](https://www.last.fm/api/tos).

## License

MIT
