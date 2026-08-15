# BL-624 spec-gap: acceptance: is a block scalar, not a single-line pointer

## What happened
Documenter finished doc updates for BL-624 (commit 0b355cf711) and attempted
`swarm_handoff.sh` to QA. The handoff was rejected by the pre-QA gate:

```
PRE_QA_GATE_FAIL acceptance-contract BL-624 acceptance: declaration is
unreadable at the cited commit (absent, inline Gherkin, or naming a feature
file that does not exist there)
```

## Root cause
`backlog/active/BL-624-onboarding-facilitator-survey-to-gate.yaml`'s
`acceptance:` field is written as a YAML block scalar (`acceptance: |`)
containing the feature-file path on its first line plus a scenario map,
supporting-gates list, and a QA end-to-end procedure below it.
`pre_qa_gate_gather_lib.bb` passes the raw `acceptance:` value straight to
`feature-text-at-commit` as a path; a multi-line value names no real file, so
`gather-acceptance-contract-facts` returns `declaration-readable? false` and
the acceptance-contract gate fails CLOSED (BL-761).

This is the same failure class already hit on BL-514 (2026-08-14, fixed by
the specifier by trimming `acceptance:` to a single-line pointer and moving
the prose into `qa_e2e:`).

## Class / blame
- class: spec-gap
- blamed: specifier (ticket authoring defect — the `acceptance:` field format,
  not the documented behavior, which is correct and unchanged)

## Disposition
Per Constitution Article 4.4, a spec-gap leaves as a `note` (priority `00`)
to specifier and coordinator, not a parcel and not a second bounce. Note sent
2026-08-16 (documenter → specifier, coordinator), naming this ticket and the
BL-514 precedent fix. The BL-624 parcel remains held by documenter,
in_process, pending the specifier's fix and an "Amending An In-Flight
Ticket's Spec" notification back to documenter.

No production code or documentation content is implicated; the fix is
confined to the ticket YAML's `acceptance:` field shape.
