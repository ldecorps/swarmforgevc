# BL-879 — coder review-stamp-off pass — 2026-08-11

## Scope reviewed

The landed hotfix, commit `36ea0109e9` on `main` (already an ancestor of
this branch): `swarmforge/scripts/process_table_lib.bb` (`parent-orphaned?`,
new), `swarmforge/scripts/orphan_janitor_lib.bb`
(`front-desk-bridge-or-bot-cmdline?`, new; `reapable-tmp-ancillary?`,
extended), `swarmforge/scripts/orphan_janitor_sweep_lib.bb` (wiring +
audit-reason string). This is a REVIEW ticket per its own framing — confirm
or refute the landed diff, not a rewrite.

## Review goal 1 — decapitation guard

`front-desk-bridge-or-bot-cmdline?` alone also matches the host front desk
by design (its own docstring says so). Traced every caller:
`tmp-ancillary-cmdline?` only reaches it inside `(and (extract-disposable-root
c) (or ... (front-desk-bridge-or-bot-cmdline? c) ...))` — the disposable-root
extraction gates first. `reapable-tmp-ancillary?`'s own `cond` checks
`in-live-window-set?` then `(not tmp-rooted-ancillary?)` before the fast-path
clause `(and front-desk-bridge-or-bot? parent-orphaned?)` — ordering matches
the invariant.

One caveat found and closed: at the real callsite
(`orphan_janitor_sweep_lib.bb`'s `sweep-candidates!`), `tmp-rooted-ancillary?`
is derived from the *same* `disposable-root-re` extraction the outer
`tmp-ancillary-cmdline?` gate already required, so at that callsite it is
always `true` by construction — an end-to-end-only test can never observe
`tmp-rooted-ancillary?=false` and therefore can never exercise the pure
function's own cond-order guard. Added an exhaustive (32-row, not sampled)
oracle test directly against `reapable-tmp-ancillary?` (P0 in the new
property runner, see below) to pin the ordering at the function's own
contract. Confirmed by deliberately reordering the cond at authoring time:
P0 caught it, the end-to-end generator test did not.

**Confirmed.** No defect.

## Review goal 2 — `parent-orphaned?` semantics

- Exception → `false` (fails closed): the whole function body is one
  outer `(catch Exception _ false)`.
- Adapter unwired → `false`: `orphan_janitor_sweep_lib.bb`'s
  `(or (:parent-orphaned?! adapters) (fn [_] false))` default. No prior
  test exercised the case where the adapters map omits the key entirely
  (only "adapter returns false" was tested) — closed via P3d /
  acceptance scenario -01's "not determinable" row.
- Missing-ProcessHandle → `true`: reviewed per the ticket's own flag. A
  pid that exits between enumeration and the probe reads as orphaned;
  `kill-pid!` on an already-gone pid is a no-op (fresh `ProcessHandle/of`
  lookup inside `kill-pid!` itself finds nothing). The pid-reuse race this
  could theoretically open is bounded by the same tick-execution latency
  the ordinary `stale?` path already carries, and the fast path reaps
  *sooner* (fresher pid, less elapsed time for reuse) than the multi-hour
  age gate would — narrower exposure, not wider.

**Testability limitation, recorded not faked:** this JDK (25) removed
`SecurityManager` (JEP 411) and `ProcessHandle/of` does not throw for any
`long` (verified: `-1` returns `Optional.empty()`, not
`IllegalArgumentException`) — there is no portable way left to force a
genuine exception through the `.parent()`/`.isAlive()` calls specifically
(as opposed to the missing-handle branch, which the outer `if-let` already
short-circuits before reaching them). The "exception → false" sub-clause is
guaranteed structurally (the catch is unconditional, so it necessarily also
covers that path) but not independently forced by a live JVM exception.
Documented in the property runner's header rather than left silent or
claimed as tested. Not a defect in the reviewed diff — a gap in what this
environment can force, not in the code's behavior.

**Confirmed**, with the one documented testability limitation above (no
follow-up ticket — see "Follow-ups" below for why).

## Review goal 3 — scope (front-desk only)

`front-desk-bridge-or-bot-cmdline?` matches only the two JS entrypoints;
babysitter-tmux/launch.sh/babysitterd.sh/tmux/claude-Babysitter shapes never
match it, so `front-desk-bridge-or-bot?` is `false` for them regardless of
PPID, and the fast-path `cond` clause never fires. Confirmed via P0
(exhaustive) and P2b (generated babysitter/tmux cmdlines under a disposable
root, freshly parent-orphaned, never fast-reaped).

**Confirmed.** No defect.

## Review goal 4 — audit reason precision

`(when (and front-desk? parent-orphaned? (not stale?)) " reason=parent-orphaned-front-desk")`
— fires exactly when the fast path was the *deciding* factor (i.e. the
ordinary age gate alone would not have reaped it yet), matching the
ticket's own stated goal verbatim. A process that is both parent-orphaned
and independently stale is reaped either way but does not carry the reason
tag, correctly distinguishing a fast reap from an age-gate reap for
forensics. Confirmed via P2a and acceptance scenario -02.

**Confirmed.** No defect.

## Review goal 5 — follow-ups

No functional defect found in the landed diff. The only real gap found was
in **test coverage**, not behavior: before this pass, `parent-orphaned?`
had zero direct test coverage of its own real semantics (only exercised
indirectly through a mocked adapter), and the sweep layer's unwired-adapter
default-fallback path was likewise untested. Both are closed in this same
parcel (BL-654: first authorship of a declared invariant's property test
rests with the coder), so no follow-up ticket is opened for that. The one
remaining item — the SecurityManager/JDK limitation above — is a
documented testability ceiling, not a code defect or missing coverage the
swarm can act on; not worth a ticket.

## Invariants (BL-654) — property tests added

New: `swarmforge/scripts/test/bl879_parent_orphaned_front_desk_property_runner.bb`.

- P0 (exhaustive, 32/32 rows): `reapable-tmp-ancillary?` matches an
  independent oracle formula over its 5 boolean inputs — invariants 1 & 3.
- P1 (300 generated runs): a host-rooted front-desk cmdline is never
  reaped end-to-end via `sweep!`, parent-orphaned or not — invariant 1.
- P2a/P2b (300 generated runs each): disposable-root front-desk
  fresh+parent-orphaned always fast-reaps with the reason tag;
  disposable-root babysitter/tmux fresh+parent-orphaned never does —
  invariants 3 & the audit-reason clause of goal 4.
- P3a–d (4 real-process/real-JVM scenarios): `parent-orphaned?`'s living
  parent → `false`, missing ProcessHandle → `true`, out-of-range pid never
  throws, and the sweep layer's fully-unwired adapter → `false` —
  invariant 2 (see the documented limitation above for the one sub-clause
  not independently forced).

Non-vacuity proven by hand at authoring time for every property (cond
reorder, regex broadening, branch flip, default-fallback flip) — restored
before this commit; see the file's own header for the exact mutations and
which property caught each.

## Acceptance — draft promoted to live

`specs/features/BL-879-swarm-stamp-parent-orphaned-front-desk-hotfix.feature.draft`
→ `.feature`. New step handlers:
`specs/pipeline/steps/bl879ParentOrphanedFrontDeskSteps.js` (registered in
`specs/pipeline/steps/index.js`), driving the real wiring through a new
JSON-bridge runner
(`swarmforge/scripts/test/bl879_parent_orphaned_front_desk_acceptance_runner.bb`),
same pattern as BL-849's. All 5 scenarios (8 examples total) pass:

```
# tests 8
# pass 8
# fail 0
```

## Independent re-verification (ran directly)

- `orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED (pre-existing,
  unmodified by this pass).
- `orphan_sweep_enumeration_unavailable_test_runner.bb` — ALL CHECKS PASSED
  (pre-existing, unmodified).
- `process_table_lib_test_runner.bb` — ALL CHECKS PASSED (pre-existing,
  unmodified).
- `bl879_parent_orphaned_front_desk_property_runner.bb` — ALL PROPERTIES
  HOLD (32 exhaustive + 300-run×3 + 4 scenarios).
- `specs/features/BL-879-...feature` via `run_acceptance.sh` — 8/8
  scenarios pass.

## Degraded gate (recorded per the ticket's own note)

Entire diff and all new tests are Babashka: no mutation/CRAP/DRY wired for
this layer (engineering.prompt, Startup Tools). The gate for this parcel is
the unit/property runners under `swarmforge/scripts/test/` plus the
promoted acceptance scenarios, all green above — never implying mutation
ran.

## Verdict

Landed hotfix confirmed correct against all three declared invariants and
all 5 of the ticket's review goals. No functional defect found; the coverage
gaps found (parent-orphaned? untested directly, unwired-adapter fallback
untested) are closed in this same parcel. Acceptance draft promoted with a
full passing suite. No follow-up tickets opened.

By coder.
