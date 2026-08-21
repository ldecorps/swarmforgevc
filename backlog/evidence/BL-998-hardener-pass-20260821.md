# BL-998 — hardener pass: verified green, no code changes needed, PASS to documenter

**Parcel:** coder D1 refix `0153d2257` (transitive closure fix for
`done_with_current_task.bb`) on the specifier's spec correction `62370af74`,
merged into cleaner's DRY hoist `19e0ad093f` (`lib/install_scripts.sh`),
then architect `a55c1b68d3` (independent re-derivation, PASS,
`backlog/evidence/BL-998-architect-review-20260821.md`). No code changes
made — arrived already thoroughly verified by both coder (own non-vacuity
proof, qa step 8, two ways) and architect (independently re-ran the guard
and got the same four newly-self-rooting helpers with no roster).

## Tooling scope — Babashka/shell, no mutation/CRAP/DRY wired

Every changed file is `.sh`/`.bb` under `swarmforge/scripts/test/` — zero
`extension/src/*.ts` touched (confirmed via `git diff --stat` vs both merge
parents). Per engineering.prompt's Startup Tools rule, this surface has no
mutation/CRAP/DRY tooling and is gated only by its own test suite —
recorded per the degraded-fallback discipline.

## Independent reverification (registered detach, host load 54-108 throughout)

All 9 affected/control shell suites run individually (batching them was
unreliable under today's sustained contention, same pattern the architect
and QA already hit this shift with unrelated files):

- `test_shell_fixture_dispatch_isolation.sh` (the guard itself): **PASS**.
- `test_handoff_state_dir_worktree_root.sh`, `test_idle_clear_respawn.sh`,
  `test_sidecar_tolerant_completion.sh`, `test_ready_for_next_no_promotion.sh`,
  `test_ready_for_next_rotate_home.sh`, `test_compliance_battery_cli.sh`,
  `test_dispatch_lib_receive_mode.sh`, `test_reference_freshness_guard.sh`:
  **all exit 0**, every named scenario line reads PASS (the
  `HANDOFF SYNC INJECT FAILED: tmux socket file missing` lines are expected
  fixture noise — no real tmux socket in a test fixture — not failures).
- `bl998_guard_membership_property_runner.bb`: **96/96 runs PASS**.
- BL-998 acceptance (`node specs/pipeline/cli.js
  specs/features/BL-998-a-shell-test-never-dispatches-into-the-real-repo.feature`):
  **5/5 PASS**, exit 0.

## Read the closure logic directly, not just the result

Read `test_shell_fixture_dispatch_isolation.sh`'s step 1b (the fixpoint
closure over sibling process invocations) in full — this is the exact
piece D1 fixed, so it is the highest-risk new logic here. The distinction
between a real process invocation (`process/exec`/`process/shell`/`sh/sh`/
`exec bb`/`bash `, an edge) and a same-shape `load-file` of a sibling lib
(in-process, not an edge) is real and correctly implemented: `load-file` is
not in `SIBLING_START_RE`, so it cannot spuriously close the self-rooting
set over every helper that merely loads a sibling module. The fixpoint loop
(`while [ "$GREW" = "1" ]`) is a standard transitive-closure shape and
terminates because `SELF_ROOTING` only grows and the universe of script
names is finite. Matches the architect's own independent read.

## Fixture/process hygiene

- `pgrep`/`ps` scoped check after all nine runs plus the property runner:
  no leaked fixture processes (`ready_for_next`/`done_with_current`/
  `sfvc-*` pattern), no orphaned `node --test`/`stryker`.
- `find /var/folders -iname "*bl998*" -o -iname "*shell-fixture*"`: empty —
  no leaked fixture directories in the system tmpdir.
- `git status --short`: clean except the known pre-existing untracked
  `swarmforge/scripts/test/fixtures/`.
- Own scratch (`tmp/bl998-*.log`, `tmp/bl998-accept-work/`) removed after use.

## Inventory result

**D1..Dn: NONE.** No coverage gap, no correctness defect. This parcel's own
severity rationale (a test suite that can silently dequeue a live parcel
out of a real role's mailbox) is exactly the defect I raised the original
note about (`20260820T160724Z_000286`) — satisfying to see it land closed
with generative, non-vacuous coverage rather than a second hand list.

Forwarding this commit (evidence file committed) to documenter.

By hardender.
