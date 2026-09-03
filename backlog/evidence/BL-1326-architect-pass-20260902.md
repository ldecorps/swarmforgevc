# BL-1326 — architect pass, 2026-09-02

Role: architect. Ticket: BL-1326-bob-restaff-anthropic-coder-qwen-db7e3f2bda.

## Received
Cleaner commit `6960d0946f` (clean sweep, forward unchanged).

## Scope check
Stamp-off review of already-landed hotfix `db7e3f2bda`. Confirmed by
`git log 39a815e605..6960d0946f -- bob-multi-provider-mono-router.conf
swarmforge.sh backlog/hotfix-ledger.yaml` — empty: no hotfix source or
ledger touched by this parcel. Only the acceptance step handler and its
zsh driver were added.

## required_wiring anchor mismatch — correctly handled, not a defect
The ticket's `required_wiring` names
`bl1323BobRestaffAnthropicStartingCastSteps`, which is stale: BL-1323 is a
different, live ticket with its own subject and its own feature file. The
coder caught this, named the handler `bl1326BobRestaffAnthropicStartingCastSteps.js`
to match its own feature file (avoiding a collision with the real BL-1323's
future handler), and raised the discrepancy to the specifier by `note`
rather than silently complying with the stale literal text or silently
fixing the ticket YAML itself. This is the correct call — `required_wiring`
exists to prove the handler is registered and executes every scenario, and
that is satisfied either way; blindly matching a stale, colliding name would
have served the letter while defeating the purpose. Confirmed:
`specs/pipeline/steps/index.js:925` registers `bl1326BobRestaffAnthropicStartingCastSteps`.

## Architecture check
- No hotfix source touched (confirmed above); nothing to re-review under
  BL-1322's exclusion (invariant 3) — the Background correctly filters
  BL-1322's bundled files out of the changed-path assertion by name.
- Scenario 02's execution design is sound: it extracts
  `extra_cli_targets_qwen_cloud`'s live text from `swarmforge.sh` via awk
  and evals it under `zsh` (matching the predicate's own word-splitting
  semantics), rather than copying the logic into the driver — avoiding
  silent drift between the reviewed predicate and what the acceptance
  actually exercises. The coder additionally confirmed the extracted
  function is byte-identical between the landed commit and the current
  working tree despite an unrelated later `swarmforge.sh` change
  (BL-1318), so the scenario genuinely executes the reviewed predicate.
- Ledger row for `db7e3f2bda`: `state: stamp-open`, `human_decision: null`
  — unmodified, confirmed independently.

## Invariants Review (BL-633/654)
Three declared invariants, all process/repo-state assertions (no pure
module to generate over — the subject is one config file at one commit),
correctly encoded as executable assertions rather than as property tests.
Verified each:
1. Never reimplements — confirmed via empty git log above.
2. Green never certifies — ledger row unmodified, confirmed above.
3. BL-1322's bundled files not re-reviewed — Background filters them out
   by name; neither file touched by this parcel.

## Verification (independent re-run)
- `node specs/pipeline/cli.js
  specs/features/BL-1326-bob-restaff-anthropic-coder-qwen-db7e3f2bda.feature`
  — 11/11 pass, including scenario 08 (only the coder window matches the
  live remap predicate) and 11 (review never self-certifies).

## Specifier-flagged bundling observation
The hotfix's own diff bundles BL-1322's paused ticket YAML and feature file
alongside the pack conf — factually confirmed by the specifier and
independently reasoned about by the coder (diffed against the parent
commit, neither file present there). Correctly not re-adjudicated here per
invariant 3; it is a provenance-hygiene observation for the human, not a
defect in this parcel or a design flaw to bounce.

## D1..Dn (Article 4.4 complete inventory)
NONE. Clean sweep — no hotfix source touched, ledger untouched, required_wiring
anchor mismatch correctly diagnosed and routed by note (not silently
complied with or silently fixed), scenario 02's live-predicate execution
design verified sound, all 11 scenarios pass.

## Disposition
Architecturally compliant. Forwarding unchanged to hardener.

By architect.
