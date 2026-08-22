# BL-1049 architect pass — 2026-08-22

**Parcel:** cleaner-forwarded commit `7a7d147e96` ("Merge commit
'59582ce8ab' into swarmforge-cleaner"), merged into `swarmforge-architect`
(no conflicts; `specs/pipeline/steps/index.js` auto-merged cleanly, confirmed
correct — `require('./bl1049ProviderSecretScrubSteps')` present, satisfying
the ticket's `required_wiring` field verbatim).

## What this fixes

`tmux new-session` seeds the SERVER's global environment from the whole
launching shell, so all seven role panes (all `claude` in the live
configuration) inherited all fifteen provider secrets, none of which any
pipeline role reads. BL-657's existing scrub hook only covered harness
markers. This parcel gives the same hook a second, DERIVED keep-list: every
provider secret the running configuration's window backends actually need,
computed from `swarmforge.conf`'s own `window <role> <backend> ...` lines,
applied only inside `scrub_tmux_harness_env` at the two call sites BL-657
already established — no new call site, no change to `swarmforge.sh` itself
(confirmed via `git diff` — zero lines touched).

## Correctness — reproduced independently, not taken on the commit message

- **The fail-open security posture, read and traced by hand** in both
  `harness_env_scrub_lib.bb` (`provider-scrub-vars`, `provider-keep-names`)
  and its shell twin (`harness_env_provider_scrub_vars`,
  `harness_env_backend_provider_vars`):
  - An EMPTY backend set (conf unreadable) → scrubs NOTHING, never guesses.
  - An UNRECOGNIZED backend name → keeps EVERY secret for that draw
    (`return 0` from within the shell's `while read` here-doc loop correctly
    exits the whole function with nothing yet printed, since the loop runs
    in the current shell — a here-doc, not a pipe, was the right choice to
    keep `return` effective).
  - Both match invariant 2's "a scrub that breaks a configured provider is a
    worse defect than the leak it fixes" exactly.
- **Invariant 1 (launcher/server separation), traced at the call sites**:
  `scrub_harness_env` (launcher process) at `swarmforge.sh:1856` runs BEFORE
  `start_handoff_daemon` at `:1923`; `scrub_tmux_harness_env` (tmux server)
  is the only one touched by this parcel, at its existing two call sites
  (`:1046`, `:1862`). Confirmed via `grep` against the live file — the
  launcher-process scrub list is byte-unchanged.
- **The zsh word-splitting bug, independently confirmed real**: the shell
  twin's provider loop must read backends line-by-line
  (`while IFS= read -r backend`) rather than `for backend in $backends`,
  because zsh does not word-split an unquoted parameter by default — the
  unquoted form would glue every backend name into one token that matches no
  `case` arm, silently scrubbing nothing while every bash-only test passed.
  Verified both syntax-clean (`bash -n`, `zsh -n`) and behaviorally identical
  under both shells via the real integration test (scenario "f", below).
- **Values are never surfaced anywhere** — read `bl1049ProviderSecretScrubSteps.js`
  in full: every fixture secret is one literal placeholder
  (`bl1049-placeholder-not-a-real-key`), `DUMP_SERVER_NAMES` strips values at
  the point of capture (`sed 's/=.*//'`) before any assertion ever sees the
  output, and the file's own header records why (a prior manual repro of
  this exact scenario dumped real keys into a transcript). No step, test, or
  property runner in this parcel prints a value at any point — checked by
  reading each file, not assumed.
- **Non-vacuity, both the leak's own reality and the fix's**: the acceptance
  step handler asserts the fixture server GENUINELY carries the leak
  (`OPENAI_API_KEY` present) before applying the scrub — a fix tested only
  against a fixture that never had the defect would prove nothing.

## Test suites — all run directly, not assumed green

- `bb test/bl1049_provider_env_scrub_test_runner.bb` — **ALL TESTS PASSED**
  (the pure classifier plus lib/shell-twin literal parity).
- `bb test/bl1049_provider_env_scrub_property_runner.bb` — **ALL PROPERTIES
  HOLD**, 240 runs (+24 real-shell runs), with floored coverage across every
  shape that matters: collision-pairs (207), independent pairs (240),
  empty-backends (38), unknown-backend (20), shell-kept (22),
  shell-scrubbed (26). Header documents 7 distinct non-vacuity breaks proven
  at authoring time, each restored, each biting the RIGHT property/sub-check
  — including a dedicated regression case for the exact zsh word-splitting
  bug found (P3c, zsh arm only).
- `bash test/test_bl1049_provider_env_scrub.sh` — **ALL PASS**: a real
  throwaway tmux server, 11 named scenarios (claude-only scrubs everything /
  BL-657 markers still scrubbed / CLAUDE_CODE_* passthroughs survive / a
  configured vibe window keeps MISTRAL_API_KEY and nothing else / a pane
  opened after the scrub cannot see a scrubbed secret / the launcher process
  itself keeps every secret / an unreachable socket is a silent no-op / an
  unreadable conf scrubs nothing / zsh and bash agree on both the computed
  list and a live server's actual result).
- Acceptance `BL-1049-...feature` run live via `specs/pipeline/cli.js` —
  **11/11 pass**. `gherkin_lint_gate.sh` on the feature file — parses
  cleanly.
- **Incidental fix independently verified real, not just claimed**: `main`'s
  `harness_env_scrub_lib.bb` defines only `scrub-map` (confirmed via
  `git show main:...`); its CLI wrapper `harness_env_scrub_names.bb` called
  `harness-marker-names`, which did not exist on `main` — genuinely dead/
  erroring, from two BL-657 implementations merging with the explicit list
  winning. `harness_env_scrub_lib_test_runner.bb` and
  `harness_env_scrub_test_runner.bb` (both pre-existing, BL-657's own) now
  run: **ALL TESTS PASSED** / **ALL PASS**.

## Dependency-rule gate (BL-259) and co-change (BL-255)

No `extension/` TypeScript file is touched by this parcel — only one JS
step-handler file (test infrastructure) plus `.bb`/`.sh` scripts. Ran the
gate anyway against the one JS file: **PASSED, no forbidden edges.**
Co-change over all changed files: every flagged pair is at frequency ≤2
(below the suspected-coupling threshold of 3) and is the genuinely-related
BL-657 sibling surface this ticket extends (`harness_env_scrub.sh` ↔
`harness_env_scrub_lib.bb` ↔ `harness_env_scrub_names.bb` ↔ their own new
BL-1049 test files) — nothing new or suspicious.

## Invariants (all three declared)

1. **Launcher keeps every secret; only the tmux server is narrowed.**
   Encoded as P1a (pure set-intersection: the launcher-scrub list holds no
   provider secret) and P1b (runs the REAL shell function in a real bash and
   reads back the survivor — a pure check alone cannot see an `unset` added
   to the wrong function). Also checked live at the integration-test level
   (a real forked-after-scrub `nohup` daemon, mimicking handoffd's own
   shape, still reads `RESEND_API_KEY`).
2. **A name the configuration needs is never removed.** P2a (COLLISION BY
   CONSTRUCTION — the drawn secret comes from the drawn backend's own needs,
   deliberately avoiding the near-vacuous independent-draw shape) and P2b
   (the non-collision half, independently drawn). The two fail-open states
   (empty backend set, unknown backend name) are injected at a fixed rate
   with floored reach rather than left to chance under a uniform draw.
3. **The Babashka lib and its shell twin name the same set.** P3a/P3b/P3c
   check literal parity, per-backend agreement, and the shell twin's actual
   runtime behavior (not just its declared list) against the lib.

## What is NOT the problem — do not change

- `swarmforge.sh` itself — untouched, confirmed via `git diff`.
- The launcher-process harness-marker scrub list — untouched.
- BL-657's existing keep-vars / harness-marker machinery — untouched, and
  its own two pre-existing test runners now pass (see above).
- The deliberate deferral of per-ROLE narrowing (a `vibe` documenter pane
  getting `MISTRAL_API_KEY` while six `claude` panes on the same server do
  not) — explicitly out of scope per the ticket's own "How" section, named
  as its own follow-up slice on the `swarm-reliability` epic.

## Verdict

COMPLIANT. A genuinely well-tested, security-conscious fix: fail-open
posture verified both by pure logic and real shell/tmux execution, the real
zsh bug caught and regression-guarded, no credential value ever surfaced by
any test or tool in this parcel, and the launcher/server separation
(invariant 1) traced to the exact call sites. Forwarding to hardener.

By architect.
