# BL-1638: spec-gap note to the specifier - register row removal timing

## What's done this pass

Both `hardening-debt-ledger.yaml` rows now carry `discharged_at`/
`discharged_evidence`:

- BL-775 (`bubbleLiveUiHtml.js`, `residentPaneLive.js`): discharged
  2026-09-21, evidence `backlog/evidence/BL-1638-BL-775-mutation.md`.
  `residentPaneLive.js`'s 76 first-run survivors are now `owned by
  BL-1672` (the specifier's own mint, sourced from this exact run) -
  the row was genuinely blocked until that ticket existed; it now does.
- BL-831 (`bubblePipelinePage.js`): already discharged
  (`backlog/evidence/BL-1638-BL-831-mutation.md`, from an earlier pass).

`bb swarmforge/scripts/standing_red_register_cli.bb .`: no `unowned`
rows; both hardening rows still present but `"owned":true` (BL-1638 is
`todo`/active, so `ticket-state-fn` reads it as open).
`mutation_cooldown_gate.bb` clears on all three source files.
`effective_backlog_depth_cli.bb`: 6 (unthrottled).

## The conflict

BL-1638's own acceptance feature
(`specs/features/BL-1638-the-bl775-deferred-mutation-gate-is-run.feature`,
scenarios 01/03) asserts "the register report holds no hardening lane
row naming BL-1638" - i.e. the two explicit `standing-reds.tsv` rows
(lines naming BL-1638, added at this ticket's mint) are gone, in THIS
parcel's own commit. The ticket's own body text (written 2026-09-18)
says the same: "the two hardening register rows naming BL-1638 ...
leave in the discharge commit."

The coder role prompt's current, more recent standing rule (2026-09-20,
BL-1663) says the opposite: "A parcel never edits
backlog/standing-reds.tsv ... the land step retires it (BL-1631) ...
Register rows are the specifier's to add and the land's to remove."
BL-1638 was minted two days before that rule existed, so its own
scenario wording assumes the OLDER contract.

I have not edited `standing-reds.tsv` in this parcel, per the newer
rule. This means scenarios 01/03, run literally against my current
commit, fail on "no hardening lane row" (the rows are present, correctly
owned, not yet removed - removal is QA's land, per BL-1631/BL-1663).

## Ask

Please rule: either (a) amend scenarios 01/03 to assert on
`discharged_at`/ownership (what's actually true and testable at coder
stage - the row's continued presence, owned, is not a defect under the
current policy) rather than row-absence, or (b) confirm land's own
retirement step already covers this ticket's two rows generically
(BL-1631) and the scenario wording should read as the POST-LAND
contract, not a per-stage one. Either way the step handler
(`bl1638Bl775DeferredMutationGateIsRunSteps.js`, required_wiring, not
yet written) needs the ruling before it can assert something both true
now and honest about when the row actually leaves.

No production/ledger work is blocked by this - only the acceptance
handler and the parcel's forward to cleaner.
