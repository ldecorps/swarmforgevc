# BL-1292 — architect pass, 2026-09-05

Ticket: BL-1292-fixture-liveness-is-decided-by-identity
Role: architect
Commit reviewed: be778d22cd (coder; stage-skip — cleaner/hardener/documenter
skipped per `stage_skip_reasons`)

## Result: NONE — no architecture, invariant, or correctness defect found

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.` The change is test-harness code only (a new
  `extension/test/helpers/fixtureLiveness.js`, a thread-through in
  `bl857TunnelOwnershipInvariants.property.test.js`, a new step-handler
  file) — no production module touched, no webview, no VS Code API, no
  secrets, no browser storage.
- **Co-change report**: nothing suspicious — only this ticket's own new
  family (its coder evidence file, the property test file, the step
  handler).
- **Register check**: `git diff be778d22cd~1 be778d22cd --
  backlog/standing-reds.tsv swarmforge/scripts/property_suite_standing_allowlist.tsv`
  is empty, and neither register carries a row for this file — correctly,
  since this is a genuine fix, not a standing-red waiver.

## Invariants Review (BL-633/654)

Declared invariant: "A test's answer to 'is this fixture still running?'
is true only while THAT fixture is running: a zombie awaiting its reaper,
and a pid reused by an unrelated process, both answer false."

- The new `property (BL-1292 invariant)` test iterates all four situations
  EXPLICITLY (a `for` loop, not sampled), with a reachability assertion
  (`undrawn` must be empty) — I ran it myself, twice: **pass both times**,
  including the genuinely-constructed zombie case (`/proc/<pid>/status`
  confirms `State: Z` before asserting).
- **Non-vacuity, independently reproduced** (not just trusted from the
  coder's evidence): backed up `fixtureLiveness.js`, reverted `isAlive` to
  the bare `process.kill(pid, 0)` form, reran the property test filtered
  to `-t "BL-1292"` — it failed immediately: `Property failed after 1
  tests... Counterexample: ["zombie"]... situation=zombie: expected
  isAlive=false, got true`. Restored the file from my backup and confirmed
  byte-identical (`diff` + `git status --short` empty).
- Confirmed all 6 pre-existing `isAlive(pid)` call sites in invariants
  1–3 were threaded through to `isAlive(pid, name)` with a name already in
  scope at each site (mechanical, no new fixture logic) — read the full
  diff, not just the coder's count.

## Independently re-verified the substance

- `npx vitest run --config vitest.properties.config.mjs
  test/bl857TunnelOwnershipInvariants.property.test.js` — **4/4 tests
  pass** (invariants 1, 2, 3 unchanged in outcome; new BL-1292 property
  passes), ~14s.
- Read `spawnZombie`'s construction in `fixtureLiveness.js`: a bash parent
  backgrounds a short-lived renamed child and never `wait`s on it before
  its own 5s sleep — the standard zombie-window construction, gated on a
  live `/proc/<pid>/status` `State: Z` probe rather than inferred from
  timing. Linux-only by design (documented); every caller runs in this
  repo's Linux CI/dev containers, consistent with the project's declared
  "macOS and Linux only" target — the identity-check itself
  (`ps -o args=`) stays POSIX for the general case, matching the
  BL-1061 portability lesson this same file already paid for.
- `spawnZombie`'s liveness-confirmation loop is a bounded busy-wait
  (`while (Date.now() - start < confirmTimeoutMs)` with no yield between
  `fs.readFileSync` calls, capped at 1500ms) — test-harness-only code, not
  production, and bounded; not a correctness defect, noting it only
  because a busy-wait is worth a second look. Not blocking.

## Acceptance wiring — driven end-to-end myself

Feature declares 3 scenarios / 6 scenario runs (Scenario 01 is a 4-example
Outline). Independently drove
`bl1292FixtureLivenessByIdentitySteps.js::registerSteps` against all 6,
**twice consecutively** (the whole point of this ticket is a verdict that
should not move under repetition) — both runs: **6/6 pass**, including the
zombie and reused-pid Outline rows and the real `tunnel_ownership_lib.sh
reap-orphans` invocation in scenarios 02/03. Confirmed
`SWARMFORGE_TUNNEL_REGISTRY_DIR` (the env var the step handler sets) is
the actual override name `tunnel_ownership_lib.sh` reads (`grep -n
SWARMFORGE_TUNNEL_REGISTRY_DIR swarmforge/scripts/tunnel_ownership_lib.sh`
— matches). `registerSteps` export present per the ticket's
`required_wiring` anchor (BL-1371, no `index.js` entry needed by design).

## required_stages / stage_skip_reasons

`required_stages: [coder, architect, qa]`. Agree with the stated skips:
cleaner (one shared helper at the existing call sites IS the
de-duplication — confirmed, nothing left to refactor), hardener (no
production module changed; the zombie/reused-pid rows already ARE the
non-vacuity check, confirmed above), documenter (no living doc/diagram
describes fixture-liveness mechanics to update). Forwarding directly to
QA.

## Verdict

Architecturally compliant. No architecture violation, no invariant
violation, no correctness defect found. Forwarding to QA.
