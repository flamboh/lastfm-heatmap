# Deployment

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
