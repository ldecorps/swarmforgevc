# BL-1096 — hardener pass, 2026-08-24

## Inbound

Merged architect `7b1cfb7859` (on cleaner `463f260c86` / coder
`a694bd2980`) into `swarmforge-hardender`.

## Scope

`check_pipeline_code_on_main.sh`: QA-import exemption asks
`is_qa_ancestor.sh` about each offending path's last-touching incoming
commit (`pipeline_path_import_exempt`), not the merge tip alone.

## Host / BL-149

`check_pipeline_code_on_main.sh`: **run** (age ~5.6d). Host quiet. No
Stryker (bash). Gherkin + surgical this pass.

## BL-113 Gherkin (soft)

```
total=10 completed=10 killed=10 survived=0
outcome: pass
```

## Hand-authored surgical

| Mutant | Result |
|---|---|
| Restore tip-level `is_qa_ancestor` gate | killed |
| Skip empty `path_anchor` guard | **equivalent (BL-234)** |
| Skip per-path QA ancestor check | killed |
| Skip staged-vs-incoming blob match | killed |
| `pipeline_path_import_exempt` always true | killed |

Equivalent: omitting `[[ -n "$path_anchor" ]]` still fails closed because
`is_qa_ancestor.sh ""` exits 1 (usage / fail-closed). Interchangeable by
design with the explicit empty-anchor return.

Survivors (behaviour): 0.

## Verification

- Acceptance 7/7; shell guard ALL PASS (BL-925 + BL-1096 cases)
- HOTFIX stamp-off matches board (`27273f2b0a`)

## Findings

NONE (one documented equivalent).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1096-qa-import-exemption-anchors-per-path-not-the-merge-tip`.

By hardender.
