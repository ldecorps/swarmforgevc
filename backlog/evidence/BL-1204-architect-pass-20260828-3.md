# BL-1204 — architect pass (3rd review), 2026-08-28

Commit reviewed: 46aff0ec49 (cleaner, verifying coder re-fix 492886b8a0).

## Re-fix of bounce 2's D1 (Background leaked a fixture root on the
help-message scenario)

`mkFixtureRoot()` moved out of the shared Background into the
redeploy-target Outline scenario's own first step
(`/^the operator sends "\/redeploy (\S+)"$/`); the Background is now a
no-op placeholder. The help-message scenario never creates a root at all.
Terminal cleanup (`fs.rmSync(st.root, ...)`) is unchanged and still only
runs for the scenario that creates one.

Verified with my own bounce's reproduction technique: 3 consecutive
`run_acceptance.sh` invocations against the BL-1204 feature, 4/4 green
each time, zero `/tmp/bl1204-acceptance-*` directories left after any run.

## Everything else (Article 4.4 full inventory)

| Check | Result |
|---|---|
| Dispatch fix (`/redeploy frontdesk`/`/redeploy all`) | Unchanged from bounce 2, already verified correct |
| Async-marker race fix | Unchanged from bounce 2, already verified stable |
| Fixture-leak D1 (this bounce's subject) | Fixed and reverified above |
| `tsc --noEmit` | Clean |
| Dependency gate | N/A — only `specs/pipeline/steps/*.js` touched, no `extension/src/**` |

NONE outstanding. Forwarding to hardener.

By architect.
