# BL-1198 hardener pass — 2026-08-27

## Reviewed commit

`ae0744ceca` (architect pass — declined a bundled backlog-surgery merge
from cleaner; coder's own BL-1198 diff `daefb98c6d` is clean). Merged into
hardender at this commit. Confirmed after merge that my worktree carries
the CORRECT `backlog/active/{BL-1188,BL-1189,BL-592,BL-644,BL-751}.yaml`
and `backlog/paused/{BL-1196,BL-1200}.yaml` originals, no stale
`hold/`/`done/` duplicates from the declined surgery.

## Gates

| Gate | Result |
|---|---|
| `master_main_reconcile_lib_test_runner.bb` (3 new `rematch-with-push-first!` cases) | ALL TESTS PASS (independently re-run) |
| `master_main_reconcile_lib_property_runner.bb` (`bl1198` invariant, 500 runs) | ALL PROPERTIES HOLD, non-vacuity confirmed (a mutant that always resets regardless of push outcome IS flagged) |
| `test_handoffd_master_main_reconcile_wiring.sh` (real-git wiring, handoffd.bb) | 4/5 pass; the one FAIL ("scenario 02") is the pre-existing, already-disposed, out-of-scope missing-3-way-merge defect coder and architect both independently found and correctly excluded — re-confirmed identical shape on my own run |
| New: `test_swarm_heal_push_before_reset.sh` (real-git wiring, swarm_heal.bb) | ALL PASS (added this pass — see below) |
| bb has no mutation/CRAP/DRY tooling (engineering.prompt) | Gated by the unit/property/real-git suites above only, per policy |

## A real gap closed: swarm_heal.bb had ZERO test coverage of any kind

Grepped `swarmforge/scripts/test/` for any reference to `swarm_heal.bb` by
name before this pass: **none**. `master_main_reconcile_lib_test_runner.bb`
/ `_property_runner.bb` only exercise the shared `rematch-with-push-first!`
primitive against fake `:push!`/`:reset!` adapters — real proof that
`swarm_heal.bb`'s own trivial `git push origin main` / `git reset --hard
origin/main` one-liner adapters are actually wired to that primitive (not
just visually reviewed by the architect) existed for **zero** of the three
real call sites this ticket touches except `handoffd.bb` (which already had
`test_handoffd_master_main_reconcile_wiring.sh`). Same required_wiring class
as this session's own BL-592 hardening pass (bridge routes verified by
reading source, not by a real test) — see this session's accepted
rule_proposal in `hardender.prompt`. Added
`test_swarm_heal_push_before_reset.sh`, registered in `suite-manifest.tsv`.

## An important honest limit, found via hand-mutation (not assumed)

Traced (not guessed) that every dispatch path into `:rematch!` —
`post-land-absorb-plan` and `automated-absorb-plan` in
`master_main_reconcile_lib.bb` — is gated `(zero? (or behind 0)) → :noop`
FIRST, so reaching `:rematch!` at all structurally requires a GENUINE
`behind > 0` divergence at decision time. Within one synchronous CLI
invocation, the push attempt that follows happens milliseconds later
against the same unmoved origin, so it is rejected too, by the same git
rule that rejects `--ff-only` in that state. **Confirmed empirically, not
just reasoned**: reverted `swarm_heal.bb`'s `:rematch!` back to a bare
`git reset --hard origin/main` (the pre-fix shape) and re-ran
`test_swarm_heal_push_before_reset.sh` — byte-identical PASS output on
both scenarios. **This new real-git test has zero discriminating power for
BL-1198's actual behavior change.** It is a genuine, valuable wiring +
regression-guard test (proves the plumbing reaches the primitive, and
proves the existing reset recovery for real divergence is undisturbed) —
it is not, and structurally cannot be, an existence proof of the fix
through this call site. That existence proof is (correctly) the property
test's `bl1198` check with fake adapters plus its own non-vacuity
confirmation, which DOES catch the identical mutant instantly. Documented
this finding directly in the new test file's header so a future reader
does not "fix" it by chasing an unreachable push-succeeds scenario through
real git, and sent a `rule_proposal` capturing the general lesson (below).

Given this ceiling applies identically to `post_hotfix_merge_origin.bb`'s
own real adapters (same trivial one-liner shape, same gated dispatch), did
not add a third structurally-limited wiring test there for the same
marginal return — noting it here as an out-of-scope observation (its
pure-logic side is already covered by `post_hotfix_merge_origin_lib_test_
runner.bb`/`bl1118_post_hotfix_merge_property_runner.bb`; only its own
real git-shelling `push-onto-origin!`/`reset-onto-origin!` functions remain
CLI-untested, same-shaped gap as `handoffd.bb`'s already had covered).

## required_wiring / constraint checks (independently verified, not taken
## on the architect's word)

- All 3 real `git reset --hard origin/main` call sites route through the
  one shared `rematch-with-push-first!` — confirmed by direct grep of
  `handoffd.bb`, `swarm_heal.bb`, `post_hotfix_merge_origin.bb`.
- `push_sweep_lib.bb` constraint ("reuse it, don't invent a second push
  path"): re-verified `push_sweep_lib.bb` is pure decision logic with no
  git-shelling function of its own — the real adapter (`push-sweep-push!`)
  is file-private in `handoffd.bb`. `swarm_heal.bb`/`post_hotfix_merge_
  origin.bb` cannot import it without pulling in a daemon entry point, so
  their own one-line `git push origin main` closures are the same
  established per-file thin-adapter convention this codebase already uses
  elsewhere — agree with the architect's disposition, not a bounce-worthy
  literal-text violation.
- Single push attempt, no retry loop: confirmed — `push!` is called
  exactly once per `rematch-with-push-first!` invocation (property test's
  own call-sequence assertions enforce this directly).
- Documentation-drift fix (`post_hotfix_merge_origin_lib.bb`'s "no
  reset/stash" → "never stash"): still accurate against the file's own
  `rematch!`-invoking branches.

## Tip purity

No mutation caches or manifest files hand-edited. `.stryker-tmp`/coverage
artifacts untouched (this parcel is pure `swarmforge/scripts/*.bb`, no
`extension/` files touched).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1198-rematch-reset-must-push-before-discarding-local-ahead-commits`.

By hardender.
