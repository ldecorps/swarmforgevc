# PWA service-worker cache-busting gap — 2026-07-10

Operator reported (phone screenshot) the burndown card showing no ETA text
next to milestones, despite BL-228 (closed today, this session) adding that
exact rendering and the live deployed `backlog.json` already carrying the
forecast data.

## Diagnosis

Confirmed via `curl` against the live GitHub Pages deploy that the CURRENT
`app.js` already contains BL-228's `milestoneEtaSuffix`/`overallEtaText`
code and correctly renders an ETA (or a "no ETA yet" fallback) per
milestone. The deployed code is correct — the operator's phone is not
running it.

Root cause is in `pwa/sw.js`:
- `const CACHE_NAME = 'swarmforge-dashboard-v2'` is a static string.
- The app shell (`app.js`, `index.html`, `locales.js`, `manifest.json`,
  `icon.svg`) is served **cache-first** (`cacheFirstThenNetwork`) — once an
  asset is cached under `CACHE_NAME`, it is served from cache indefinitely.
- The `activate` handler's cache-eviction logic (`caches.keys().then(keys =>
  ... delete keys !== CACHE_NAME)`) only runs when a NEW service worker
  version installs, which only happens when the browser detects `sw.js`
  itself changed byte-for-byte on a fetch.
- BL-228 (and BL-235/BL-236/BL-238, all today) changed `app.js`/`index.html`
  content but never bumped `CACHE_NAME` in `sw.js`. Since `sw.js`'s own bytes
  were unchanged, no new SW version ever installed on an already-visited
  device — the shell cache from before any of today's changes is still being
  served, unbounded, with no TTL and no other invalidation path.

## Blast radius

Not specific to BL-228. **Every future content-only change to the PWA shell
silently never reaches an already-installed user** until `CACHE_NAME`
happens to be bumped for some unrelated reason. This has been true since the
service worker was built (BL-097/BL-117) — any release since then that
didn't happen to touch `CACHE_NAME` has the same exposure, not just today's.

## Wanted behavior (for the specifier to scope precisely)

- Shell content changes should reliably reach an already-installed PWA
  within a bounded time (next open, or next periodicsync at latest) —
  without requiring a human to remember to hand-bump a version string.
- Likely direction: derive `CACHE_NAME` (or a per-asset cache key) from a
  content hash of the shell assets at build/deploy time (the
  `backlog-dashboard.yml` workflow already runs at deploy), so a real
  content change always produces a new cache identity automatically — no
  new manual step, no ticket needs to remember to touch `sw.js`.
- `backlog.json`/`docs-tree.json`/`recert-batch.json` (the network-first
  data URLs) are unaffected — this is a shell-asset-only gap.

## Operator's immediate workaround

Clear the dashboard PWA's site storage/data (or uninstall and reopen it) to
force a fresh service-worker registration and cache fill.
