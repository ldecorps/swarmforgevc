# BL-1330 — hardener pass, 2026-09-02

Role: hardender. Ticket: BL-1330-swarm-stamp-bob-anthropic-starting-cast-441fd35112.

## Received

Architect commit `542e48aded` (clean sweep, no defect, forwarding).

## FINDING — merged sibling fix for a wiring gap the architect's tip did not carry

The architect's tip (`542e48aded`) predates the coder's rework of scenario
02's step handler. Running the acceptance suite against it failed:

```
not ok 8 - the coordinator's staffing is unchanged by this commit
error: no step handler matched "And the coordinator agent, model and effort
are unchanged by commit 441fd35112"
```

Cause: the specifier amended scenario 02's step text (`734f6da6f6`) after
the coder's original spec-gap note (the old clause asserted over diff TEXT
and was unsatisfiable — see the ticket's own `specifier_amendment_2026_09_02`
record). The coder then reworked the step handler to match the amended text
(`49677d5881`, "rework for the amended sc-02, and take ownership of the zsh
driver" — this same commit also renames
`lib/bl1326QwenRemapPredicateCli.zsh` to `lib/bl1330QwenRemapPredicateCli.zsh`
since BL-1326's retirement deleted the original file and BL-1330 is its only
remaining caller). That rework reached `swarmforge-cleaner`
(`cc72a0eab8`, "Merge architect 542e48aded (clean sweep) into cleaner for
BL-1330") but not the git_handoff mailbox copy that reached this hardener
worktree.

Per this role's own "Acceptance pre-check" duty (do not forward a parcel
whose acceptance cannot execute for want of a step handler) and per BL-317's
"amending an in-flight ticket's spec" rule (merge first), this hardener
worktree merged `cc72a0eab8` (commit `c9bf3acaeb`) rather than hand-patching
around it — the fix already existed and had been reviewed on its own branch;
re-deriving it independently risked the BL-1032-class divergent-sweep
mutant this branch's own accepted rule warns against.

Also confirmed by that merge: BL-1326's retirement cleanup (dangling step
handler + its zsh predicate driver removed, registration dropped) landed
alongside the coder's rework in the same commit.

## Acceptance re-run (post-merge)

`node specs/pipeline/cli.js specs/features/BL-1330-swarm-stamp-bob-anthropic-starting-cast-441fd35112.feature`
— 12/12 pass, including scenario 02 against the amended step text, scenario 06
(duplicate-landing assertion), 09-10 (Qwen scoping), 11 (no script/lib code
changed), 12 (no self-certification).

`specs/pipeline/steps/index.js:925` registers
`bl1330SwarmStampBobAnthropicStartingCastSteps` — required_wiring anchor
satisfied. Grepped repo-wide for stray references to the retired
`bl1326QwenRemapPredicateCli.zsh` / `bl1326BobRestaffAnthropicStartingCastSteps.js`
— none found; the rename left no orphans.

## Whole-tree guards (specs/pipeline/steps/ touched)

```
cd extension && npx vitest run $(ls test/*Guard*.test.js | grep -v '\.property\.')
```
3 files red: `tempDirTrapGuard`, `socketFixtureShortRootGuard`,
`liveRepoDerivationGuard`. All three are pre-existing standing debt, already
ticketed and unrelated to this parcel's changed files
(`bl1330SwarmStampBobAnthropicStartingCastSteps.js`,
`lib/bl1330QwenRemapPredicateCli.zsh`, `index.js`):
- `socketFixtureShortRootGuard` — `bl1112StandingUnitRedsSteps.js` and
  `bl691AmbulanceWorkflowGapsSteps.js`, tracked by paused
  `BL-1290-a-socket-fixture-is-rooted-short-enough-to-bind.yaml`.
- `tempDirTrapGuard` — 21 `swarmforge/scripts/test/` runners, tracked by
  paused `BL-1289-a-temp-root-is-always-cleaned-up.yaml`.
- `liveRepoDerivationGuard` — tracked by paused
  `BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`.

Per BL-1063 (a red outside your parcel is already ticketed until grepped
otherwise): grepped `backlog/` for each guard/file name before recording —
all three came back ticketed. No new tickets minted.

## Mutation / CRAP / DRY

No `extension/src/*.ts` production source touched by this ticket's full
chain (coder → cleaner → architect → hardener) — confirmed by diffing this
branch against the pre-parcel merge-base: only
`specs/pipeline/steps/bl1330SwarmStampBobAnthropicStartingCastSteps.js`,
`specs/pipeline/steps/index.js`, and
`specs/pipeline/steps/lib/bl1330QwenRemapPredicateCli.zsh` changed. CRAP and
Stryker are not applicable (CRAP scopes to `src/*.ts`; Stryker's `--mutate`
scopes to `out/**/*.js`, neither touched). No BL-113 Gherkin
`Scenario Outline` mutation applies beyond scenario 01, which is unchanged
by this pass.

Hand-verified the reworked scenario 02 assertion is not vacuous: it names
`coordinator_agent`/`coordinator_model`/`coordinator_effort` explicitly via
three separate `assert.match` calls (not only a before/after `assert.equal`,
which could pass on two identically-empty reads) — this is the coder's own
documented fix for exactly that hazard, confirmed correct by reading.

No mutation/CRAP/DRY tooling gap to flag beyond the above — this is a
review-only, config-confirmation parcel per the ticket's own scope.

## Disposition

No hardening changes beyond merging in the sibling fix that closed the
acceptance gap. Forwarding to documenter.

By hardener.
