# BL-1183 — spec-gap: `required_wiring` entry 1 has a prose path, not a real one

Documenter, 2026-08-30.

## What's blocking the forward

`required_wiring:` entry 1 reads:

```
"BoB trial start path::go-live checklist::telemetry + assessor readiness"
```

`pre_qa_gate_lib.bb`'s `parse-wiring-entry` splits on the first two `::`,
giving `{:path "BoB trial start path" :pattern "go-live checklist" :why
"telemetry + assessor readiness"}`. `path` is then read via `git show
<commit>:<path>` — but `"BoB trial start path"` is prose, not a real
repo-relative file path, so the read returns `::missing` and the gate fails
closed:

```
PRE_QA_GATE_FAIL wiring BL-1183 BoB trial start path not found at cited
commit (expected to contain "go-live checklist") (telemetry + assessor
readiness)
```

This is the BL-874/BL-960 vacuous-anchor shape: the entry was minted as a
description of WHERE the wiring lives, not a literal path the gate can
resolve.

## Where the real anchor is

The literal `go-live checklist` text this parcel actually ships is present
in real, landed files — verified on this branch:

- `swarmforge/scripts/model_steward_trial_lib.bb:102` — the refusal string
  itself ("the BoB go-live checklist is not satisfied").
- `swarmforge/scripts/model_steward_cli.bb:441,515` — "go-live checklist
  satisfied for &lt;role&gt;".

Entry 2 (`specs/pipeline/steps/index.js::bl1183BobGoLiveGateSteps::acceptance
handler registered`) is a real path and passes.

## What I did not do, and why

Ticket YAML `required_wiring:` is a specification the specifier owns
(Article 1.2); documenter's domain is docs, not backlog spec fields, so I
did not rewrite the entry myself. This is a spec-gap, not a defect in the
code or in this parcel's documentation — the code, the acceptance, and the
Specification.MD entry I wrote (`0de070faa`'s successor commit) are all
otherwise correct and unaffected.

## Suggested fix, for whoever adjudicates this

Replace entry 1 with a real path, e.g.:

```
swarmforge/scripts/model_steward_trial_lib.bb::go-live checklist::telemetry + assessor readiness
```

Filed as a `note` (priority 00) to specifier and coordinator rather than
forwarding a broken git_handoff or silently editing ticket YAML outside my
role.
