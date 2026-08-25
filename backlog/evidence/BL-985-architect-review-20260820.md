# BL-985 — architect review pass: PASS to hardener (clean sweep, NONE)

- **Ticket**: BL-985 — heal wrapper cannot see drift into a sibling
  worktree, `type: defect`, `severity: high`, M8, `mutation_cost: low`.
- **Received**: `git_handoff` from cleaner, `750e9be45e` ("Merge coder
  BL-985 (8c166c444d) for cleanup" — pure passthrough, no cleaner edits of
  its own), task `BL-985-drift-into-sibling-worktree-is-re-anchored`.
  Merged clean into `swarmforge-architect`.
- **Reviewer**: architect, 2026-08-20.
- **Verdict**: **PASS to hardener — clean sweep, NONE.**

## Architecture review — proactive git-toplevel anchor

Read `tool_miss_heal_lib.bb`'s diff and traced the shell logic by hand:

```
__sfh_pin_top="$(cd "$__sfh_root" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)"
__sfh_cwd_top="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -n "$__sfh_pin_top" ] && [ "$__sfh_cwd_top" != "$__sfh_pin_top" ]; then
  cd "$__sfh_root" || exit 1
fi
```

Verified each case by hand against real git behavior:
- **Own worktree, any subdirectory**: `git rev-parse --show-toplevel` from
  a subdirectory returns the WORKTREE's own root regardless of depth, so
  `__sfh_cwd_top == __sfh_pin_top` — no re-anchor, byte-untouched. Matches
  the no-drift firm line.
- **Sibling worktree** (e.g. `.worktrees/documenter`): a linked worktree
  has its OWN distinct toplevel in git's model even though it sits
  physically inside the master checkout's directory tree — this is the
  exact case the ticket calls out as defeating a naive path-prefix test.
  Comparing toplevels (not paths) correctly discriminates it: different
  toplevel → re-anchor. Confirmed this is the right primitive for
  precisely the reason the ticket names.
- **Outside any repository**: `git rev-parse --show-toplevel` fails,
  `__sfh_cwd_top` is empty, empty ≠ pin's toplevel → re-anchor.
- **Unresolvable pin** (a fixture root that isn't a real repo):
  `__sfh_pin_top` itself is empty → `[ -n "$__sfh_pin_top" ]` is false →
  guard skipped entirely, fail-open — the documented pre-BL-985 behavior
  for that case, preserving every existing fixture-driven suite.
- The verdict is computed BEFORE the original command runs and does not
  read the command's own output at all — satisfies invariant 2 by
  construction (there is nothing in this block that could depend on
  success/failure).

Overhead note (not a defect): this adds two `git rev-parse --show-toplevel`
calls to every wrapped Bash invocation, drift or not — an intentional,
ticket-sanctioned cost of deciding proactively ("decide from where the
shell IS, before the command runs") rather than a violation of the
no-unconditional-behavior-change constraint, which is about not rewriting
the command unconditionally, not about paying zero verification cost.

## Doc-half and sibling co-change

- `swarmforge.sh`'s generated launch-script comment (constraint from the
  ticket's own notes) no longer overclaims "pins every Bash command" —
  now states exactly what re-anchors (different-worktree/outside-repo,
  decided before the run) and what does not (a shell inside its own
  worktree). Read both the old and new comment text side by side; the new
  text is accurate to what the code now does.
- `bl960_heal_wrapper_acceptance_runner.bb`'s `rootAppendedInSource` proxy
  is sharpened from "wrapper mentions `$__sfh_root` anywhere" (which the
  proactive anchor would now make trivially true in EVERY wrapper, a
  latent false-positive) to the exact forbidden composition (`original`
  followed by `"$__sfh_root"` as a trailing argument). Justified,
  minimal, and necessary — without it BL-960's own regression suite would
  have silently stopped meaning anything for this specific check.

## Dependency-rule gate / co-change

- Dependency-rule gate: only the pre-existing BL-759 `acyclic` cycle
  (telegram-front-desk-bot.js family) — unrelated, no file this parcel
  touches sits under `extension/src` or `extension/media`.
- Co-change: `tool_miss_heal_lib.bb`'s top co-changers are its own sibling
  test runners and hook (`tool_miss_heal_lib_test_runner.bb`,
  `tool_miss_heal_lib_property_runner.bb`, `tool_miss_heal_hook.bb`) — all
  expected, long-standing. Nothing new.

## Invariants review (BL-633/654) — both declared, both encoded and non-vacuous

1. **A role's command never executes outside its pinned worktree**: encoded
   by `bl985_proactive_anchor_property_runner.bb`'s per-draw recorded-`pwd`
   check across six place classes (own-root, own-subdir, sibling-root,
   sibling-subdir, outside-any-repo, an unrelated standalone repo) — every
   drifted draw's recorded pwd must equal the pinned root, every non-drifted
   draw's must equal exactly the drawn cwd. Acceptance scenarios 01
   (Outline, both worktree examples), 02, 04.
2. **Verdict independent of success/failure**: encoded by drawing
   succeeding-while-drifted and failing-while-drifted as independent random
   classes with their own reach floors, both asserted re-anchored
   identically. Acceptance scenario 01's own precondition step proves the
   probe command SUCCEEDS unwrapped at the drifted cwd (the exact silent
   class the old guard missed) before asserting the wrapped run corrects
   it.
- Non-vacuity: two documented staged-first breaks — break 1 removes the
  proactive block entirely (RED on succeeding sibling-drift draws,
  reproducing the original reported defect exactly); break 2 narrows the
  comparison to fire only on empty-toplevel (re-expressing the OLD
  blindness proactively) — RED specifically on sibling-drift draws while
  outside-repo draws stay green, which is exactly the discrimination the
  ticket exists to add. Both are targeted, meaningful breaks, not
  boilerplate mutations.
- No violation found on either declared invariant.

## Verified live, not from the parcel's own claims

- `node specs/pipeline/cli.js specs/features/BL-985-drift-into-sibling-worktree-is-re-anchored.feature`:
  **5/5 pass** (28.9s, run detached to clear this session's ~2min
  foreground tool cap).
- `bb swarmforge/scripts/test/bl985_proactive_anchor_property_runner.bb`
  at the shipped default (`runs=40`, also detached): **ALL PROPERTIES
  HOLD**, coverage `{:own-place 11 :sibling-drift 14 :outside-repo 6
  :other-repo 9 :succeeding-drift 15 :failing-drift 14 :multi-segment 17}`
  — every reach floor met (own-place≥4, sibling-drift≥5, outside-repo≥3,
  other-repo≥2, succeeding-drift≥5, failing-drift≥3, multi-segment≥4).
- `bash swarmforge/scripts/test/test_tool_miss_heal_hook_wiring.sh`:
  **ALL SCENARIOS PASS** (10/10, including the two BL-960 parse-safety
  cases and the settings-registration check).
- Sibling regression run live: BL-913 **6/6**, BL-934 **3/3**, BL-965
  **4/4**, BL-960 **10/10** — every count matches the coder's own stated
  test inventory exactly.

Minor observation, not a defect: the property runner's `:failing-drift`
coverage counter can mislabel a draw where both `multi?` and `fails?` are
independently drawn true — the `cond` picks the multi-segment branch first,
so no `; false` is actually appended, yet the `:failing-drift` counter
still increments for that draw. This is a coverage-bookkeeping nuance only
(the actual invariant assertions don't read the `fails?`/`multi?` flags at
all — they check the recorded pwd unconditionally), and with 40 draws the
non-overlapping failing-drift-only case still fires independently well
past its floor. Not worth a bounce; noted for completeness.

## Property-testing pass

No new undeclared-property coverage warranted: the parcel touches no
TypeScript/JS pure module under `extension/src` — only Babashka (`.bb`)
production code, a shell-generated comment, and an integration-style
acceptance step handler. The declared invariants are the property surface
here and are already fully covered.

## Everything else

No correctness defects found reading the diff or exercising the code. The
live-swarm confirmation (qa_e2e step 5) is explicitly left to QA per the
ticket's own procedure — not something this stage can or should run.
