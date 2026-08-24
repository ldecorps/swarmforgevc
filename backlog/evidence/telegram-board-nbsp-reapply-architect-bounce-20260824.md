# telegram-board-nbsp-reapply — architect bounce — 20260824

## Reviewed commit

Cleaner tip `c52966d2ad` (on coder `a966f07948`) merged into
`swarmforge-architect`. Ancestry confirmed.

## Prior QA bounce clearance (D1–D2) — verified this pass

| Item | Check | Result |
|---|---|---|
| QA D1 | Feature named-entity wording + BL-1113 board Outline | 9/9 green |
| QA D2 | `pipelineBoard.ts` == `27273f2b0a`; properties 2/2 | OK |
| Dep-gate / board unit | PASSED / 127/127 | OK |
| Ledger | `27273f2b0a` still `pending` / `human_decision: null` | OK |

Board + feature restore is correct. Tip is still not landable: the same
`7975ad98a` hitchhiker set left stamp-off **narrative** surfaces claiming
`&#160;` while HOTFIX_PATHS emit `&nbsp;`.

## Review inventory (Article 4.4) — remaining defects

### D1 — behavior (docs drift) — blamed: coder

- **Evidence:** `docs/reference/Specification.MD` still states
  `escapeHtml` emits `&#160;` (named `&nbsp;` not Telegram-allowed).
- **Failure class:** `behavior`
- **Expected vs observed:** Stamped `27273f2b0a` / restored tip emit
  named `&nbsp;`; Spec contradicts the certified blob.
- **Remediation:** Restore Specification to the stamped named-entity
  wording, or mint a BL-848 stamp-off after human certify/waive of a real
  `&#160;` change. Do not land this tip with contradictory docs.

### D2 — behavior (done-ticket narrative drift) — blamed: coder

- **Evidence:** `backlog/done/M8/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.yaml`
  still claims `escapeHtml emits &#160;` and vitest for `&#160;`.
- **Failure class:** `behavior`
- **Remediation:** Align the done ticket with the certified `&nbsp;`
  surface (same as architect bounce D2 on BL-1093 —
  `backlog/evidence/BL-1093-architect-bounce-20260824.md`).

### BL-1093 cross-link (not a second bounce parcel)

Sibling bounce `b2f01988c7` already sent BL-1093 to coder for the same
Spec/YAML hitchhikers plus a red feature (feature now green here). Coder
may clear D1–D2 of this inventory in either tip; both land paths must be
clean before QA.

## Findings that are NOT defects this pass

- QA D1–D2 of `telegram-board-nbsp-reapply-qa-bounce-20260824.md`: cleared.
- No undeclared property gap on the restore (no new pure module).

## Routing

Earliest owning role: **coder**. Finish the stamp-off narrative strip
(Spec + done YAML); keep the board/feature restore.

By architect.
