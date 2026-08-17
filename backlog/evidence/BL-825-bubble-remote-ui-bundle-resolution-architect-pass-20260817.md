# BL-825 — architect pass — 2026-08-17

## Scope reviewed

Parcel received from cleaner via `merge_and_process cleaner adb294cdd5`.
First pass through architect on BL-825's own content — its coder commit
(`0f4de7bf8`) previously rode unreviewed inside the BL-908 branch (see
`BL-825-stranded-at-coder-found-in-BL-908-branch-20260817.md` and
`BL-908-held-pending-BL-825-gates-qa-20260817.md`); the coordinator routed
BL-825 through its own `required_stages` starting from that same commit, so
this is the first architect eyes on it. `git log --oneline main --
'backlog/evidence/BL-825*'` — no prior bounce history.

Two commits in scope:

- `0f4de7bf8` (coder) — `UiBundleResolver.kt` (pure resolve/parse, no
  `android.*` type in its own signature), `BridgeClient.kt` (network fetch +
  atomic device cache + `resolveUiBundle` orchestration), `build.gradle.kts`
  (`buildConfig = true` for `BuildConfig.VERSION_CODE`), the real caller
  (`TalkEngine.syncUiBundle()` / `OverlayService.onCreate()`), the bridge
  route (`letsTalkUiBundle.ts` wired into `bridgeServer.ts`'s
  `buildJsonRoutes`), a cross-reference comment in `letsTalkRoutes.ts`, four
  `*PropertyTest.kt` files (one per declared invariant plus the parse
  whole-or-nothing property), `UiBundleResolverTest.kt`, the acceptance step
  handler, and its `letsTalkUiBundle.test.js` bridge-side example tests.
- `adb294cdd5` (cleaner) — extracts `boolFromEnv` (verbatim-duplicated
  between `letsTalkBubbleConfig.ts` and `letsTalkUiBundle.ts`, jscpd-flagged)
  into `extension/src/util/envFlag.ts`, alongside the project's other
  cross-cutting bridge helpers. No behavior change; both call sites now
  import the shared function.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js src/bridge/letsTalkUiBundle.ts
src/bridge/bridgeServer.ts src/bridge/letsTalkRoutes.ts
src/bridge/letsTalkBubbleConfig.ts src/util/envFlag.ts` (run from
`extension/`) — **PASSED: no forbidden edges.**

## Co-change coupling (informational, BL-255)

`node extension/out/tools/co-change-report.js` against the same five files.
`letsTalkUiBundle.ts` shows only the 1-co-change self-consistent slice (its
own parcel's files, expected for a brand-new module). `bridgeServer.ts` and
`letsTalkRoutes.ts` show high historical co-change counts (33 with their own
test files, teens with sibling route files) — both are long-standing hub
files that every `letsTalk*` route addition touches; this predates BL-825
and is not a new or surprising coupling this parcel introduces. No hidden
coupling.

## required_wiring (2 entries)

- `extension/src/bridge/letsTalkRoutes.ts::ui-bundle` — the ticket assumed
  the GET manifest route would live in this file; it turns out to be the
  POST write-routes file only (`turn`, `new-session`). Real wiring is
  genuine and functional: `letsTalkUiBundle.ts` exports
  `getLetsTalkUiBundleManifest`/`isLetsTalkUiBundlePath`, registered into
  `bridgeServer.ts`'s `buildJsonRoutes` array (same sibling mechanism as
  `bubble-config.json`/`chiptunes.json`, confirmed by reading the diff) and
  checked I traced the route table dispatch (`bridgeServer.ts:2014`) sits
  *after* `isAuthorizedForRead` (`bridgeServer.ts:1988`) — genuinely
  authenticated, not exposed unauthenticated or via the static `pwa/`
  (confirmed `grep -rn ui-bundle pwa/` — no hits). The literal pin is
  satisfied by a real cross-reference comment in `letsTalkRoutes.ts`
  pointing at the actual route location — same resolution shape as the
  BL-901 pre-commit/commit-msg precedent (a genuine functional split, not a
  decorative placeholder; compare BL-874, where a literal `<helper-name>`
  placeholder matched nothing at all). Verdict: satisfied.
- `android/app/src/main/java/com/swarmforge/floatcompanion/BridgeClient.kt::resolveUiBundle`
  — traced the real caller chain: `OverlayService.onCreate()` calls
  `talkEngine?.syncUiBundle()`, which calls
  `BridgeClient.resolveUiBundle(ctx, base, token, BuildConfig.VERSION_CODE)`
  on every overlay start (pair/resume), same cadence as
  `syncBridgeInstanceAndSession`/`syncChiptunesCatalog`. Not only unit
  tests. Verdict: satisfied.

## Invariants review (BL-633/BL-654)

All three declared invariants have coder-authored, non-vacuous property
tests (`kotlin.random.Random`-seeded, established `*PropertyTest.kt`
convention — this project has no Kotlin property-test library pinned, per
the constitution's Startup Tools table, so seeded-fuzz + JUnit is the
established substitute). Read all four property-test files in full,
including each non-vacuity companion (a deliberately-buggy resolver shown
to fail the property):

- Invariant 1 (always leaves Talk usable) —
  `UiBundleResolverNeverThrowsPropertyTest`: 2000 fuzzed runs, `bundle` is
  null iff `outcome == BARE`, for any served/cached/reachability/shell
  combination including negative and mismatched versions.
- Invariant 2 (whole-or-nothing, rejected bundle never displaces cache) —
  `UiBundleResolverParseWholeOrNothingPropertyTest` (parse side) +
  `UiBundleResolverKeepsCachedIntactPropertyTest` (resolve side, 2×500 runs):
  a shell-behind or not-newer served bundle never displaces or partially
  merges into a compatible cached one; the returned bundle is the cached
  object's fields verbatim.
- Invariant 3 (never more confident than the evidence) —
  `UiBundleResolverEvidenceConfidencePropertyTest`: 1000+2000 fuzzed runs,
  unreachable never yields FRESH/CACHED (only STALE/BARE), and no returned
  bundle ever exceeds the installed shell's `minShellVersion`.

Independently traced `UiBundleResolver.resolve()` by hand against all three
invariants and the ticket's four-outcome/shell-behind-refusal table (fresh/
cached/stale/bare, `usable()` filtering both served and cached before any
comparison, `fetchUiBundleManifest`'s `reachable`-vs-`ok` split correctly
distinguishing "bridge answered with garbage" from "bridge unreachable" so a
malformed response falls through to CACHED rather than incorrectly reporting
STALE) — logic is correct, no gap found beyond what the property tests
already encode.

## Property-testing pass beyond declared invariants (BL-654 scope)

`letsTalkUiBundle.ts`'s bridge-side `parseUiBundleManifest`/
`getLetsTalkUiBundleManifest` is a touched, property-shaped pure module
(whole-or-nothing rejection is a real property) with only example-based
coverage (5 cases: default, valid, malformed→default, disabled,
force-rollback) — no `*.property.test.js`. Checked whether this is a gap
specific to BL-825: the sibling modules this ticket explicitly mirrors
(`letsTalkBubbleConfig.ts`, `letsTalkChiptunes.ts`, same BL-765 fallback
posture) carry no property test either — this is a pre-existing convention
across the whole operator-file-backed-route family, not something BL-825
introduced or worsened. The property this parser would encode is already
authoritatively covered on the Kotlin side (the device is what actually
decides fresh/cached/stale/bare and re-validates independently per this
file's own doc comment — "the phone re-validates independently"); the TS
parser is a secondary/looser guard. Judged not worth adding here, both to
avoid inconsistent scope creep beyond BL-825's own slice and because the
correctness-critical property is already rigorously fuzz-tested where it
matters. No new property test added.

## Two-layer boundary / architecture rules

Not the extension-host/webview/tmux surface this project's usual
architecture rules target — BL-825 is Bubble (Android) + the bridge server.
Checked project-specific rules instead: no `android.*` type in
`UiBundleResolver`'s own signature (Testability Boundary — Bubble,
confirmed by reading the file — only `org.json.JSONObject`); device-surface
code (`Context`, file I/O) is confined to `BridgeClient.kt`'s thin edge,
documented in its own doc comments as verified by BL-825's recorded manual
procedure, not the JVM suite; the manifest route is genuinely authenticated
(above) and never served through the static `pwa/`; the device cache write
happens only on a confirmed FRESH outcome (never cached/stale/bare), so a
rejected served bundle can never corrupt the last known-good cache; the
auth token is read from `CompanionPrefs.getToken(appContext)`, the app's own
existing device-side store, same pattern as every other sync call — no new
secrets-handling surface.

## Cleaner's DRY extraction

`extension/src/util/envFlag.ts` is a correct, minimal extraction — checked
`extension/src/util/` for any pre-existing similar helper the cleaner should
have reused instead of creating a new file (none found); both call sites
updated, no behavior change, no leftover duplicate.

## Correctness read

No correctness defect found beyond what's covered above. `UiBundleFetchResult`'s
`reachable`-vs-`ok` split (the bug coder's own commit message says it caught
and fixed pre-commit) is real and correct: a genuine connection-level
exception is the only path to `reachable = false`; an HTTP response of any
status, including malformed bodies, sets `reachable = true`.

## Tests reran myself

- `npm run compile` (extension) — clean.
- `npx vitest run test/letsTalkUiBundle.test.js test/letsTalkBubbleConfig.test.js test/bridgeServer.test.js`
  — 109/109 pass (6 + 4 + 99).
- `gradlew :app:testDebugUnitTest --tests "com.swarmforge.floatcompanion.UiBundleResolver*"`
  (via the BL-769 `androidGradle.js` seam, portable JDK 17 resolved from the
  main checkout) — BUILD SUCCESSFUL, 23/23 relevant JUnit tests pass (0
  failures) across all four property-test classes plus `UiBundleResolverTest`.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-825-bubble-remote-ui-bundle-resolution.feature`
  — 6/6 scenarios pass.

## Hardener note (per the ticket's own verification section)

No Kotlin mutation/CRAP/DRY tool is pinned in this project — the `.kt` half
runs the degraded unit-test-gap fallback; record that, do not imply mutation
ran on it. The TypeScript bridge half (`letsTalkUiBundle.ts`,
`bridgeServer.ts`, `letsTalkRoutes.ts`, `envFlag.ts`) is in normal
Stryker/jscpd/CRAP scope and is not exempt.

## Verdict

NONE — no architecture violation, no invariant violation, no correctness
defect. Both `required_wiring` entries independently traced and confirmed
genuinely satisfied. Forwarding to hardener.
