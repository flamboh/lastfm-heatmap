# Deployment

Requirements: Bun 1.3+, a Cloudflare Workers Paid account, a
[Last.fm API key](https://www.last.fm/api/account/create), and a GitHub personal
access token that can query the GraphQL API. Add `read:user` when private
contribution totals for the token owner should be included.

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

4. Add both credentials as encrypted secrets:

   ```sh
   bunx wrangler secret put LASTFM_API_KEY
   bunx wrangler secret put GITHUB_TOKEN
   ```

5. Deploy:

   ```sh
   bun run deploy
   ```

## Continuous deployment

GitHub Actions verifies and deploys every push to `main`. Add a repository
Actions secret named `CLOUDFLARE_API_TOKEN` containing a Cloudflare API token
with permission to deploy this Worker. The workflow can also be run manually
from GitHub's Actions page.

For local development, copy `.dev.vars.example` to `.dev.vars`, add the API
keys, and run `bun run dev`. Do not commit `.dev.vars`.
