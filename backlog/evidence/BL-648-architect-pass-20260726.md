# BL-648 — architect PASS (round 2, after architect bounce #1)

- Ticket: `BL-648-relaunch-resume-orphan-claims`
- Reviewed commit: `0ada474942` (cleaner batch tip; BL-648's own work is `d2327f832`)
- Prior round: architect bounce #1 `a83366643` — "the orphan sweep can abort the
  whole launch". No QA bounce exists for this ticket (`git log main --
  backlog/evidence/BL-648*` is empty), so bounce #1 is the only prior defect to clear.
- Verdict: **PASS** — forwarded to the hardener.

## Bounce #1 is fixed, and fixed as a class

Bounce #1: `swarmforge.sh` is `#!/usr/bin/env zsh` + `set -euo pipefail`, and the
sweep was a bare command reached AFTER `stop_handoff_daemon` and AFTER the kill
loop — so any non-zero exit aborted the launch with the swarm fully dead: no
daemon, no sessions, nothing to nudge. Strictly worse than the 11-minute stall
BL-648 exists to fix.

Re-verified against the shell wiring itself, with my own harness rather than the
shipped tests (`resolve_and_sweep_relaunch_resume` sourced out of the REAL
`swarmforge.sh` via the `ZSH_EVAL_CONTEXT` toplevel guard, a fake `bb` first on
PATH — note PATH must be set INSIDE the `zsh -c` body, since `~/.zshenv`
re-exports the real one). Five failure modes, all of which previously killed the
launch:

| fake `bb` behaviour | function exit | resident boots as | marker after | launch continues |
|---|---|---|---|---|
| `resolve-boot-role` exits 1 | 0 | home | untouched (`QA`) | yes, LOUD line |
| prints unknown role `not-a-role` | 0 | home | untouched (`QA`) | yes, LOUD line |
| `sweep` exits 1 | 0 | `QA` | `QA` | yes, LOUD line |
| both succeed | 0 | `QA` | `QA` | yes |
| stderr noise on resolve | 0 | `QA` | `QA` | yes (stdout uncontaminated) |

Both of my repros from bounce #1 are now permanent named tests, not just fixed:
`test_relaunch_resume_cli.sh` BL-648-07 (colliding reclaim target → exit 0, claim
left in place, surfaced loudly) and BL-648-08 (roster with no roles.tsv →
never the literal string `nil` on stdout, empty stdout, loud stderr line).

The secondary defect the coder found in the same pass — `cmd-resolve-boot-role`
printing the literal `"nil"`, which the launcher wrote straight into the durable
marker — is real and correctly fixed at the source (stdout is a real role name or
nothing) AND at the consumer (validated against `ROLE_INDEX` before the write).

## Gates

- **Dependency-rule gate (REQUIRED, BL-259):** `node out/tools/dependency-gate.js`
  full-repo scan — **PASSED: no forbidden edges.** (Full-repo scan used
  deliberately: this parcel's changed files straddle the `extension/` boundary,
  where per-file paths hit the `cwd=EXTENSION_ROOT` artefact.)
- **Co-change (BL-255, informational):** `swarmforge.sh` co-changes broadly with
  `swarm_ensure.bb` (13), `handoff_lib.bb` (10), `handoffd.bb` (9),
  `chase_sweep_lib.bb` (4) — the launcher's normal logical neighbourhood. The one
  worth naming: `swarm_ensure.bb` also reads `mono-router-active-role`, and this
  parcel deliberately does NOT run the sweep from `./swarm ensure` (ensure kills
  nothing, so "owner alive" would be ambiguous there). That is the correct call and
  is documented in the code; flagged only so a future ensure-side change knows the
  two readers exist.
- **Suites:** `orphan_claim_lib_test_runner.bb`, `orphan_claim_sweep_lib_test_runner.bb`,
  `mono_router_lib_test_runner.bb`, `bl648_relaunch_resume_property_runner.bb`,
  `test_relaunch_resume_cli.sh`, `test_bl648_resident_boot_role_override.sh` — all green.
- **Acceptance:** `node specs/pipeline/cli.js specs/features/BL-648-relaunch-resume-orphan-claims.feature`
  → 7/7 pass. `.feature.draft` correctly materialized to `.feature` with handlers
  wired in the same parcel (BL-441/BL-233).
- **Regression, launcher-adjacent** (because `swarmforge.sh` changed):
  `launch_contract_test_runner.bb`, `test_resume_on_start.sh`,
  `test_rotation_sequential_pack.sh`, `test_swarm_ensure.sh`,
  `test_swarm_launch_pack_guard.sh` — all green.
- **Step-registry collision check:** `bl648...Steps.js` is appended LAST in
  `steps/index.js`, and every one of its patterns is `^…$`-anchored. The only
  near-miss, `bankedBriefingHeadlessSteps.js`, registers
  `/^the swarm relaunches to a live coordinator later the same day$/` — a
  different anchored literal, so no shadowing in either direction.

## Architecture

Unchanged from bounce #1's assessment, which was already an unconditional PASS on
structure:

- Pure/impure split (`orphan_claim_lib.bb` decision + `orphan_claim_sweep_lib.bb`
  wiring) mirrors the existing `fixture_reaper` / `orphan_agent_reaper` pairs.
- All I/O behind injected adapters (`:roles`, `:session-alive?`, `:log!`); tests
  need no tmux socket and no live swarm.
- `relaunch_resume_cli.bb` is root-explicit throughout rather than CWD-derived,
  with the reason stated — correct, since the launcher does not `cd` into the
  target and this ticket is precisely about cross-worktree launch correctness.
- `resolve_launch_script_for_role` lifted out of `launch_role` so the
  script-selection decision is testable without a live tmux session.
- Sweep placement verified against the source, not the comment:
  `prepare_workspace` (fresh `roles.tsv` + `swarm-identity`) at 1740 →
  `stop_handoff_daemon` 1747 → kill loop 1749 → **sweep 1762** → first session
  created after the banner. So "session alive" at sweep time cannot mean "this
  launch's not-yet-created session", and the rotation mode the CLI reads is
  THIS launch's, not the previous one's.
- The resident is index 1: `provision_coordinator` always registers the
  coordinator LAST, so the boot-role override can never land on the coordinator's
  pane.

## Declared invariants (BL-633/BL-654)

Both declared invariants carry executable property tests, and I confirmed
non-vacuity by breaking the real implementation rather than trusting the runner's
own self-report:

- Removed the `(not being-resumed?)` guard from `claim-reclaim?` → the property
  runner went **red, exit 1, 22 failures**, PART A reporting a failure and PART B
  naming concrete diverging worlds. Restored.
- PART A is exhaustive over the entire 3-boolean domain; PART B composes the real
  `resolve-boot-role` with the real `claim-reclaim?` over 500 seeded worlds
  against an oracle re-derived from the ticket text, carries three permanently
  encoded defective variants, and asserts generator coverage instead of assuming
  it.

**Invariant 1** ("no relaunch strands a claimed parcel: the resident resumes that
role or surfaces the claim") — holds, including in the failure direction: when
`resolve-boot-role` fails or names an unknown role, `MONO_ROUTER_BOOT_ROLE`
becomes empty and the sweep therefore runs with `resumed-role=""`, so the
recorded role's own claim is reclaimed rather than left invisible. The two halves
compose when either half breaks, which is what item 3 of the ticket asked for.
Swept for other sites: the reclaimed parcel lands in a dormant role's `inbox/new/`
with no wake, so I checked the consumer — `handoffd`'s `role-mail-row` scans
`inbox/new/` from disk and counts `git_handoff` files as actionable, so the chase
sweep rotates the resident to it. The reclaim is not a dead end.

**Invariant 2** ("never touches a claim whose owner is alive or being resumed — a
healthy in-flight parcel is never re-delivered into a duplicate") — holds, and
holds structurally: the only mutation entry point (`reclaim-file!`) and the batch
directory cleanup (`cleanup-empty-batch-dirs!`) are BOTH inside the `reclaim?`
branch, so a live owner's tree is never touched by either. The reclaim is an
`fs/move`, never a copy, so a duplicate is impossible by construction even when
the marker is stale about which role the resident was at. Re-dequeue of a
reclaimed parcel is safe: `set-header!` REPLACES an existing `dequeued_at` in
place rather than appending a second one, so a reclaimed parcel is not
quarantined as corrupt on its second trip through `ready_for_next`.

## Property-testing pass (architect-owned)

No new property test is warranted by this parcel, and that is a finding rather
than an omission: the two pure modules it touched (`orphan_claim_lib.bb`,
`mono_router_lib.bb`) are already property-covered as above, the sweep half is
impure wiring, and the parcel touched no pure TS/JS module, so there is nothing
for `fast-check` / `npm run test:properties` to add here. I did not manufacture a
vacuous one.

## Passed forward, not blocking — for the hardener

1. **`resolve_and_sweep_relaunch_resume` itself has no shipped test.** The CLI's
   internal catches are covered (BL-648-07/08) and `resolve_launch_script_for_role`
   is covered, but the shell function holding the two `if ! bb …` guards, the
   `ROLE_INDEX` validation, and the marker write is exercised by nothing. I proved
   all five failure modes by hand (table above); that proof should become a
   permanent test. The harness is three lines: source the real `swarmforge.sh`
   with the toplevel guard, `parse_config; write_roles_file;
   write_swarm_identity_file`, then put a fake `bb` on PATH from INSIDE the
   `zsh -c` body (outside it, `~/.zshenv` wins and the real `bb` runs — that
   silently made my first attempt test nothing at all).
2. **`reclaim-file!` can misreport a successful reclaim.** `fs/move` and
   `remove-sidecars-of!` share one `try`: if the move succeeds and a sidecar
   delete then throws (EACCES, a stale mount), the parcel IS in `inbox/new/` but
   the log says "could not reclaim … left claimed; surfacing" and it is excluded
   from the reclaimed count. Not a parcel-safety defect — the parcel is fine and
   `collect-in-process` counts only `.handoff` files, so the orphaned sidecars are
   inert litter, not a wedge — but an operator acting on that line could
   hand-deliver a second copy. Splitting the sidecar cleanup into its own guarded
   step makes the log honest.
3. **PART B asserts the decision, not the tree.** Stubbing out the `fs/move` so
   `reclaim-file!` reports success without moving anything leaves the property
   runner fully green (exit 0, "ALL PROPERTIES HOLD") while
   `orphan_claim_sweep_lib_test_runner.bb` correctly fails. PART B is not vacuous
   for the property it encodes — invariant 2 genuinely is not violated by that
   break — but the effect layer is example-covered only. Driving `sweep!` against
   real temp dirs and asserting file locations would close it.

## Surfaced, not swept (BL-506)

Two ticket-less items in this worktree, left untouched and unstaged:

- `swarmforge/scripts/test/test_swarm_handoff_mono_router_auto_rotate.sh` —
  untracked, dated 2026-07-22, present in no branch including `main`. Not created
  by this review and not part of BL-648.
- `swarmforge/scripts/test/test_swarm_launch_pack_guard.sh` is committed mode
  `100644`, so it cannot be run directly (`Permission denied`); it passes under
  `bash <file>`. Pre-existing and unrelated to this parcel.

By architect.
