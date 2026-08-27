# BL-1174 — hardener tip-pure pass — 20260827

## Inbound

Architect `d50cc7b1f1` (ambulance patient). Tip-pure handoff on that tip
(BL-506 / avoid hitchhikers after BL-1173 QA bounce).

## Scope

`/deprecate` soft verbs under `extension/src/tools/deprecate/` (+ thin barrel):
policy/scan/retire. Soft Gherkin **inapplicable** (no Scenario Outline) —
BL-638 surgical sweep.

## Host / cooldown

| File | Decision |
|---|---|
| `policy.ts` | **run** |
| `scan.ts` | **run** |
| `retire.ts` | **run** |

## BL-113 Gherkin (soft)

```
outcome: inapplicable (no Scenario Outline)
```

## Hand-authored surgical

8/8 killed (`bl1174_deprecate_mutation_sweep.sh`):
seat gate, rank recurrence, orphan excludes live flags, envelope refuse,
human-ask, closesTicket stays false, conf flag removal, docs index link.

## Hardening added

Unit case: `orphanConfSignals` excludes flags with extra tree hits
(`hits > 1`), locking the live-flag skip that the surgical mutant targeted.

## Verification

- Unit (deprecate + telegram cores): **79/79**
- Properties: **4/4**
- Acceptance BL-1174 feature: **5/5**
- Surgical sweep: **8/8 killed**, 0 survived, 0 skipped

## Tip purity

Handoff delta is hardener-only on architect tip: orphan unit case +
mutation sweep script + this evidence. No sibling-ticket hitchhikers.

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1174-deprecate-operator-verbs-scan-docs`.

By hardender.
