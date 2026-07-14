# BL-249 bounce evidence — 20260710 (hardener)

## Failing command

No command reproduces this today (no test exercises the cross-file
interaction) — this is a deterministic code-inspection finding, reproduced
by reading `pwa/sw.js`'s activate handler against `pwa/app.js`'s own cache
usage. See "Repro" below for the exact logic that fires on the next
shell-changing deploy.

## Commit hash tested

`3b6b5d61c5` (hardener merge point; full BL-249 range starts at
`b093296b91` coder / `f700bd1c04` cleaner).

## First error excerpt

Not an error today — a silent, deferred regression. The failure only
manifests on the FIRST real deploy after this ticket ships that changes
any shell asset (the exact case BL-249 exists to make routine). At that
point, every returning user's browser runs this activate handler
(`pwa/sw.js`):

```js
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});
```

`CACHE_NAME` is now the per-deploy content hash BL-249 stamps in. `app.js`
line 26 opens a SEPARATE, still-hardcoded cache under
`LOCALE_CACHE_NAME = 'swarmforge-dashboard-v2'` to persist the locale
(BL-118) and font-size (BL-220) preferences — its own comment says this
"must match sw.js's CACHE_NAME." Before BL-249 both constants were the
same never-changing literal, so they stayed accidentally in sync and this
purge never touched app.js's cache. Now that CACHE_NAME actually changes
(BL-249's whole point), `'swarmforge-dashboard-v2' !== <new-stamped-name>`
on every such deploy, and the filter above deletes it — wiping every
returning user's locale and font-size preference.

## Failure class

`behavior`

Not a compile/unit/acceptance-suite failure — `npm test` is fully green
and BL-249's own acceptance scenarios (3/3) pass, because none of them
simulate a SEPARATE cache opened under the static
`'swarmforge-dashboard-v2'` name being present at activate time the way
`app.js`'s real locale/font-size persistence would be in production. This
is an intent/behavior gap between two files, invisible to any test that
only exercises one of them in isolation.

## Expected vs observed

Expected: a deploy that changes the shell updates the SHELL cache only;
users keep their locale/font-size preferences across the update (BL-249's
own design goal is "no forced re-download," and destroying unrelated
preference state is a worse regression than the stale-shell bug it fixes).
Observed: the activate handler purges ANY cache key that isn't the new
CACHE_NAME, with no exception for app.js's separately-named preference
cache — so the very next shell-changing deploy silently wipes it.

## Suggested fix scope (architect/coder call, not spec'd here)

Some way to make app.js's preference cache immune to the shell-versioning
purge — e.g., a SEPARATE, permanently-static cache name for preferences
distinct from the shell cache (never stamped), or have the activate
handler's purge only delete keys matching the CACHE_NAME's own hash
SHAPE rather than any non-matching key. Either preserves BL-249's shell-
invalidation goal without collateral-deleting unrelated preference state.
Not choosing here — this needs a design decision, not a hardener-side
test patch (hardener does not own product behavior).

## Why the existing test suite didn't catch it

`pwaServiceWorker.test.js`'s new "a returning user with a stale cache
gets the updated shell" case only seeds a stale SHELL cache under an old
hash name before firing activate — it never seeds a second cache under
the static `'swarmforge-dashboard-v2'` name the way app.js's real
locale/font-size persistence would. `pwaLocale.test.js`/
`pwaFontSize.test.js` each open `'swarmforge-dashboard-v2'` directly but
never exercise it through a second, differently-stamped sw.js activate
cycle either. No existing test simulates the actual cross-file
interaction a real deploy triggers.
