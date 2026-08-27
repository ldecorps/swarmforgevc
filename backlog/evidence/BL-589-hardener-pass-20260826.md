# BL-589 — hardener pass — 20260826

**Architect tip:** `908f926aa0`  
**Task:** `BL-589-approval-ask-carries-ruling-options`

## Merge

- `merge_and_process architect 908f926aa0` — clean merge (architect branch
  also carried BL-593 feature paths; retained per stacked architect tip).

## Gates

| Gate | Result |
|------|--------|
| Unit (backlogReader, topicRouting, pendingApprovalReply, bot core, approvalAskClosing) | **687/687** |
| `approvalAskClosing.property.test.js` | **1/1** |
| APS BL-589 | **5/5** |
| Soft Gherkin mutation | **inapplicable** (no Scenario Outline) |
| Surgical mutation sweep | **4/4 killed** (`bl589_approval_ruling_mutation_sweep.sh`) |

## Hardening added

- Regression: `rule:` callback with non-numeric tail dropped as unrecognized.
- Surgical sweep over index indirection, option rows, `human_ruling` emission,
  and numeric-only rule callback pattern.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-589-approval-ask-carries-ruling-options`.

By hardender.
