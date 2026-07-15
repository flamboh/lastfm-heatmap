# Last.fm Heatmap

![flamboh's heatmap](https://fm-heat.oli.boo/flamboh?display=minimal)

Embeddable GitHub-style activity graphs for Last.fm scrobbling stats.

```html
<a href="https://www.last.fm/user/YOUR_USERNAME">
  <img src="https://fm-heat.oli.boo/YOUR_USERNAME" alt="Last.fm activity" />
</a>
```
or

`https://fm-heat.oli.boo/YOUR_USERNAME.png` to embed on social platforms like Discord or Twitter.

- `GET /:username` and `GET /:username.svg` return a theme-adaptive svg.
- `GET /:username.png?theme=light` returns a light-mode png.
- `GET /:username.png?theme=dark` returns a dark-mode png.

All formats accept a `display` parameter:

- `display=full` is the default and includes dates, totals, attribution, and the
  legend.
- `display=dates` keeps the month and weekday labels but removes the footer.
- `display=minimal` returns only the heatmap itself.

Use svg for websites, png for external embeds.

## How it works

- A Cloudflare Worker fetches completed scrobbles from Last.fm.
- Daily aggregates are stored in Workers KV. After the first 53-week backfill,
  refreshes overlap the previous two days and fetch only recent data.
- Rendered svg and png responses are cached at the edge for six hours.

See [DEPLOY.md](DEPLOY.md) to deploy your own instance.
