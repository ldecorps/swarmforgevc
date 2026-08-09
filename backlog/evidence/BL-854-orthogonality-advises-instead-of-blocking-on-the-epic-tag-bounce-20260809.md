# BL-854 architect bounce — 2026-08-09

## Reviewed commit

`fba2c3c26a` "BL-854: demote orthogonality to a non-blocking advisory naming
overlapping tickets" (By coder, forwarded unchanged by cleaner).

## Review pass — complete inventory (Article 4.4)

- Dependency-gate hard gate: N/A — no `extension/src`/`media/` files touched
  by this parcel (all changes are under `swarmforge/scripts/`, `specs/`,
  `backlog/`). Confirmed by inspecting `extension/.dependency-cruiser.cjs`'s
  `from`/`to` path scopes, which only match `^src/` and `^media/`.
- Co-change tool (`extension/out/tools/co-change-report.js`) against the
  three changed core files (`promotion_gates_lib.bb`, `promotion_gates_cli.bb`,
  `promote_and_route_next.sh`): all "SUSPECTED COUPLING" hits are among files
  this same commit intentionally touches together (the declared BL-663
  chokepoint + its own tests) — no unexpected coupling. PASS, informational
  only.
- Invariant 1 ("orthogonality never refuses"): encoded and verified by
  property P7 (`promotion_gates_lib_property_runner.bb`), confirmed
  non-vacuous per the commit's own documented break-then-restore. Ran
  `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb` myself:
  `ALL PROPERTIES HOLD` (500 runs/property, ends with
  `generator coverage: multi-id-advisory=134`). PASS.
- Invariant 2 ("advisory names every overlapping ticket"): encoded and
  verified by property P8, same run, PASS.
- Invariant 3 ("human_approval/depth/hold/Article-3.2.4-ranking unchanged"):
  confirmed by inspection — the diff to `promotion_gates_lib.bb` touches only
  the orthogonality section; `human-approval-refusal`, `depth-refusal`,
  `hold-refusal`, `expedited?`, `rank-candidates` are byte-unchanged. PASS.
- Unit tests: ran `promotion_gates_lib_test_runner.bb` and
  `promotion_gates_cli_test_runner.bb` myself — `ALL PASS` both. PASS.
- Acceptance: ran the new
  `specs/features/BL-854-orthogonality-advises-instead-of-blocking.feature`
  (8/8 scenarios pass) and the amended
  `specs/features/BL-663-promote-and-route-enforces-every-promotion-gate.feature`
  (8/8 scenarios pass) myself via `node specs/pipeline/cli.js`. PASS.
- Gherkin lint gate on the new feature file: ran
  `swarmforge/scripts/gherkin_lint_gate.sh` myself — `OK: ... parses
  cleanly`. PASS.
- `depends_on: [BL-853]` landing order: confirmed BL-853 already closed
  (`backlog/done/BL-853-...yaml`, closed on `main` before this commit).
  PASS.
- `human_approval: approved` on the ticket (required given
  `approval_context` frames this as a policy call): confirmed present.
  PASS.

## D1 — manifest state discarded by hand (class: behavior, blamed: coder)

The commit deletes the entire `# acceptance-mutation-manifest-begin` /
`# mutation-stamp` / `# acceptance-mutation-manifest-end` block from
`specs/features/BL-663-promote-and-route-enforces-every-promotion-gate.feature`
(diff: 4 removed lines at the top of the file, no replacement) as part of
removing the dead `orthogonality` Examples row from that feature's Scenario
Outline.

`swarmforge/roles/hardender.prompt:102-103`: **"Preserve mutation manifests
and any other project manifests; do not hand-edit or discard manifest
state."** — discarding is named separately from hand-editing and is
independently forbidden. `engineering.prompt:77`'s "No hand-edited
mutation/Gherkin-mutation manifests" guardrail exists so manifest state only
ever changes as the output of a real tool run
(`swarmforge/vendor/aps/bb/src/aps/mutation.clj`'s `write-mutation-metadata!`
et al., invoked via `run_gherkin_mutation.sh`), never a hand-authored diff
hunk in either direction.

The tool's own design already tolerates a stale manifest sitting next to
edited scenarios: each manifest entry carries a `scenario_hash` recomputed
from current content on every run (`manifest-entry-reusable?`), so a changed
or removed scenario is simply re-mutated while unrelated, unchanged
scenarios' prior clean results are merged forward
(`merge-reusable-previous-scenarios`). Deleting the whole block instead
throws away that reuse for the file's OTHER, untouched scenario
(`depth, orthogonality, and hold markers...` -> renamed to `depth and hold
markers...`, but the surviving `active_backlog_max_depth` / `hold marker`
rows did not change) and forces a full re-mutation of the file on the next
hardener pass instead of an incremental one.

Precedent (8 prior commits editing a feature file's scenarios with a live
manifest already present — e.g. `b2d54fd4`, `5ce3446a`, `a3543be3`,
`6c3441cd`, `9058ceca`, `54b9c133`, `232baeaf`) uniformly LEFT the stale
manifest in place in the scenario-editing commit, with a dedicated later
hardener-pass commit (e.g. `24b2b850`, `2a72e4dd`) actually running the tool
to regenerate it. `f6f7a527` ("BL-575: hardener re-verify — restore mutation
manifest stripped by bounce-revert") independently confirms a
missing/stripped manifest is treated as a defect to repair by RUNNING the
tool, never as an acceptable state to leave or hand-restore.

The commit message's own framing — "Its mutation manifest stamp will need
regenerating; do not hand-edit it (engineering.prompt guardrail)" — correctly
avoided fabricating a fake hash/JSON by hand, but performed the other
hand-operation the same guardrail (via hardender.prompt's explicit wording)
separately forbids: discarding it.

**Remediation**: restore the four deleted lines
(`# mutation-stamp: sha256=...` through `# acceptance-mutation-manifest-end`,
byte-identical to their pre-commit content) at the top of
`specs/features/BL-663-promote-and-route-enforces-every-promotion-gate.feature`,
leaving them stale in place. The hardener's own pass regenerates them by
running the real Gherkin mutation tool, as it does for every other
scenario-editing commit in this repo's history — no other file in this
commit is affected.

## Verdict

Every other check in this pass is clean (see inventory above). This single
item is the whole bounce. Sent back to **coder** — the role that introduced
the deletion — per Article 4.3 (defect ownership) and the architect's
correctness-defect send-back rule (this role's prompt).
