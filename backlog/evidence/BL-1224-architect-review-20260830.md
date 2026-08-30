# BL-1224 — architect design review, 2026-08-30

Reviewed commit `0264c3c99` (coder), merged via cleaner (`3bc1e28b53`) into
architect as `b7d22b9ee3`. This file was never written the first time this
parcel passed through — QA correctly bounced for the missing gate artifact
(`backlog/evidence/BL-1224-bounce-20260830.md`); the review itself was done
in-session but not recorded. Recording it now, unchanged from what was
actually checked at the time.

## What changed

`operator_runtime_watch_lib.bb`'s `decide` gained an ADOPTION gate between
the deliberate-stop check and `check-one-fn`: `adoptable-pid` reads the
runtime pidfile and, only when it names a DIFFERENT live
`operator_runtime.bb` than the tracked one, treats the vanished tracked pid
as a deliberate handover rather than a crash. `adopt-entry` carries
`:attempts` over untouched and clears `:crashed-at-ms`. `operator_runtime_supervisor.bb`
wires `:pidfile-pid` (read fresh every tick) into `decide`, and adds an
`:adopted` arm to `log-event!` (the coder's own find: the previous bare `nil`
default would have logged nothing for `:adopted`, invariant 3's exact
failure mode).

## Constraints checked against the diff directly, not just the tests

- `check-one!` (`front_desk_supervisor_lib.bb`) is untouched — confirmed via
  `git diff` showing zero changes to that file in this commit. The five
  other supervisors sharing it (`negotiation_relay_supervisor.bb`,
  `onboarder_supervisor.bb`, `cursor_bridge_supervisor.bb`,
  `front_desk_supervisor.bb`, `bridge_headless_supervisor.bb`) are therefore
  structurally unaffected.
- No new liveness predicate: `adoptable-pid` takes the caller's own `alive?`
  (in production, the cmdline-checked `pid-alive?`), so pid reuse is ruled
  out by the same check BL-993's bounce required, not a second one.
- `healthy?`'s meaning is untouched (grepped, no changes).
- `:pidfile-pid` is optional in `decide`'s destructuring, so any caller that
  doesn't supply it (none currently do besides the operator-runtime
  supervisor) behaves exactly as before.

## Invariants

1. "A vanished tracked pid is counted as a crash unless the pidfile names a
   different, live operator_runtime.bb process." — `adoptable-pid`'s guard is
   exactly this AND, in order: pidfile-pid present, different from tracked,
   tracked genuinely dead, pidfile-pid genuinely alive. Property-tested over
   all four pidfile states (400 runs, coverage confirms all four exercised).
2. "An adoption never starts a process and never consumes a restart
   attempt." — structural, not a convention: the adoption branch in `decide`
   never calls `check-one-fn`, the only thing that calls `spawn!` or
   increments `:attempts`. `adopt-entry` only `assoc`s `:pid`/`:status`/
   `:crashed-at-ms`/`:started-at-ms`, leaving `:attempts` untouched.
3. "Every adoption is visible in the watch's own log and status file." —
   `log-event!` gained an explicit `:adopted` arm (see above); `check!`
   calls `write-status!` unconditionally on every non-stopped tick,
   regardless of which branch `decide` took.

## The one thing NOT to get wrong, verified directly

`announced-event?` is `#{:started :re-armed :gave-up}` — `:adopted` is not
in that set, so `announcement-for-event` returns `nil` for it and no human
Telegram announcement fires, matching the ticket's constraint that an
adoption is not an incident.

## Runs (reproduced during this review)

- `bb swarmforge/scripts/test/operator_runtime_watch_lib_test_runner.bb` —
  ALL PASS.
- `bb swarmforge/scripts/test/bl1224_watch_adoption_property_runner.bb` —
  ALL PASS, 400 runs/invariant, coverage over all seven named branches
  (different-live-runtime / tracked-alive / same-dead-pid / budget-spent /
  absent / tracked-dead / live-unrelated).
- `bash swarmforge/scripts/test/test_operator_runtime_watch_adoption.sh` —
  15/15, driving the real `operator_runtime_supervisor.bb`.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1224-watch-adopts-a-deliberately-restarted-operator-runtime.feature`
  — 7/7.
- `node extension/out/tools/co-change-report.js
  swarmforge/scripts/operator_runtime_watch_lib.bb
  swarmforge/scripts/operator_runtime_supervisor.bb` — ordinary, already-
  updated companions only (BL-993 family, index.js, own test runners). No
  action.

## Disposition

No defect found. Design review passed — this file is the record QA's bounce
asked for. Forwarded to hardender (unchanged commit content, no code
touched by this pass).
