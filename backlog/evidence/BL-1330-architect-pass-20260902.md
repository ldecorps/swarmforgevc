# BL-1330 — architect pass, 2026-09-02

Role: architect. Ticket: BL-1330-swarm-stamp-bob-anthropic-starting-cast-441fd35112.

## Received
Cleaner commit `bf7bc999b3` (clean sweep, forward unchanged).

## Scope check
Stamp-off review of already-landed hotfix `441fd35112`. Confirmed by
`git log 516ff8fb36..bf7bc999b3 -- bob-multi-provider-mono-router.conf
swarmforge.sh backlog/hotfix-ledger.yaml` — empty: no hotfix source or
ledger touched by this parcel.

## FINDING 1 — duplicate landing across two tickets, verified independently
The coder found `441fd35112` (this ticket) and `db7e3f2bda` (BL-1326,
reviewed earlier this session) have byte-identical diffs across the same
three files, different parents, neither an ancestor of the other, and only
`441fd35112` reaches `main`. Independently re-verified:
- `diff <(git show db7e3f2bda --format=) <(git show 441fd35112 --format=)`
  → empty.
- `git merge-base --is-ancestor 441fd35112 main` → exit 0 (on main).
- `git merge-base --is-ancestor db7e3f2bda main` → exit 1 (NOT on main).
- Both have their own hotfix-ledger row (`stamp_ticket: BL-1330` and
  `BL-1326` respectively).

This is a genuine finding: the human is being asked to certify the same
functional change twice, one of the two rows naming a commit that never
reached `main`. Correctly handled — raised to the specifier by `note`
priority `00`, not adjudicated in this parcel (retiring/reconciling one of
the two tickets or ledger rows is a specifier/human call, not architect's
or coder's/cleaner's to make unilaterally). Consistent with Article 4.4's
spec-gap routing and with my own domain: this is not an architecture defect
in the reviewed commit, it's a backlog-bookkeeping duplicate.

## FINDING 2 — scenario 02 wording gap, correctly narrowed and reported
Scenario 02 as minted claimed the commit's diff "touches no coordinator-
related line," which is literally false (six header COMMENT lines mention
the coordinator, including dropping the word "Max"). The coder correctly
distinguished the invariant's actual claim (no coordinator CONFIG VALUE
changed) from the scenario's over-broad wording, encoded the true claim,
and surfaced the prose delta by note rather than silently loosening the
assertion to make it pass. Verified: `config coordinator_agent`,
`coordinator_model`, `coordinator_effort` are unchanged; only comment
prose changed. Correct handling — a scenario wording defect at mint is a
spec gap, not something to quietly patch around.

## Architecture check
- No hotfix source touched; only the acceptance step handler was added.
- Scenario 03 (remap predicate) deliberately reuses
  `bl1326QwenRemapPredicateCli.zsh` rather than a second copy — avoids two
  extractors drifting against each other while both look correct. Confirmed
  the predicate's live text is byte-identical between `441fd35112` and the
  reviewed tip, same discipline as BL-1326.
- Scenario 04's honest limit (no launch script actually generated/run;
  the DETERMINANT — `extra_cli_targets_qwen_cloud` plus the two gates that
  key off it in `swarmforge.sh:1958-1967` and `:2219-2228` — is executed
  instead) is the correct call: running the real launcher would spawn tmux
  sessions and live agents, outside the testable-module boundary.

## Invariants Review (BL-633/654)
Three declared invariants, all facts about one config file at one commit
plus a predicate over seven fixed CLI strings — exhaustively covered by the
Outline and the executed predicate rather than sampled, correctly not
converted to a generated property test. Re-checked:
1. Exactly one coder Qwen window, six Anthropic windows — confirmed by
   reading the conf's window lines directly.
2. 1M declaration / QWEN_API_KEY coder-only — confirmed via the two gate
   line numbers cited above, both keyed off the same predicate.
3. Never reimplements — confirmed via empty git log above.

## Verification (independent re-run)
- `node specs/pipeline/cli.js
  specs/features/BL-1330-swarm-stamp-bob-anthropic-starting-cast-441fd35112.feature`
  — 12/12 pass, including scenario 06 (duplicate-landing assertion),
  09-10 (Qwen scoping), 11 (no script/lib code changed), 12 (no
  self-certification).
- `specs/pipeline/steps/index.js:926` registers
  `bl1330SwarmStampBobAnthropicStartingCastSteps` — third required_wiring
  anchor satisfied; the other two (claude-sonnet-5 / qwen3.8-max staffing)
  confirmed by reading the conf directly.
- Ledger row for `441fd35112`: `state: stamp-open`, `human_decision: null`
  — unmodified.

## D1..Dn (Article 4.4 complete inventory)
NONE (in architect's domain). Two genuine findings exist (duplicate
landing; scenario wording gap), both correctly routed to the specifier by
note rather than adjudicated here — neither is an architecture defect in
the reviewed commit, and neither warrants a bounce.

## Disposition
Architecturally compliant. Forwarding unchanged to hardener.

By architect.
