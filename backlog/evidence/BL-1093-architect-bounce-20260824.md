# BL-1093 — architect bounce — 20260824

## Reviewed commit

Cleaner tip `2209360cf2` (on coder `572a19ba37`), fast-forwarded into
`swarmforge-architect`. Ancestry confirmed.

## BL-1093 own gates (for completeness — not defects)

| Gate | Result |
|---|---|
| `nobody-assigned?` + complementary readers / DRY `list-active-yaml-items` | Architecture OK (option: all four nobody spellings) |
| `dispatch_gap_test_runner.bb` | ALL PASS |
| `landed_but_open_test_runner.bb` | OK |
| BL-1093 acceptance | 8/8 |
| `bl1093NobodyAssignee.property.test.js` | 3/3 |
| Dep-gate on property test | PASSED |
| HOTFIX_PATHS blob identity vs `27273f2b0a` | OK (all six) |

BL-1093's nobody-normalisation at the read boundary is architecturally
sound and invariant-encoded. The tip is **not landable** because of
hitchhikers absorbed with `7975ad98a` (merge origin/main) that rewrite the
just-certified BL-1113 stamp-off surface out of step with the stamped
blobs.

Sibling tip `a966f0794` (`telegram-board-nbsp-reapply`) already restores
feature + board on another line and is **not** an ancestor of this tip.

## Review inventory (Article 4.4)

### D1 — acceptance / behavior — blamed: coder

- **Failing command:**
  `node specs/pipeline/cli.js specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`
  → 7 pass / **2 fail** (EXIT=1).
- **Commit hash checked:** `2209360cf2`
- **First error excerpt:**
  ```
  no step handler matched "And the stage header uses an HTML numeric nbsp
  entity between DC and QA"
  ```
- **Failure class:** `acceptance`
- **Expected vs observed:** Stamp-off steps still match
  `…HTML nbsp entity…` and assert `/DC&nbsp;QA/` (named entity, stamped
  `27273f2b0a`). Tip feature (via `7975ad98a`) rewrote the Then line to
  `…HTML numeric nbsp entity…` with no matching step — acceptance red
  without touching the stamped production blob.
- **Remediation:** Restore
  `specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`
  wording to the stamped named-entity form (same shape as `a966f0794`), or
  mint a separate BL-848 stamp-off before changing the contract. Do not
  land BL-1093 under a tip that reds BL-1113.

### D2 — behavior (stamp-off narrative drift) — blamed: coder

- **Evidence:** `backlog/done/M8/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.yaml`
  now claims `escapeHtml emits &#160;` / vitest for `&#160;`, while live
  `pipelineBoard.ts` still matches `27273f2b0a` (`&nbsp;`) and
  `bl1113CursorHotfixStampOff.property.test.js` is green on blob identity.
- **Failure class:** `behavior`
- **Remediation:** Restore the done-ticket narrative to the certified
  named-entity wording, or complete a real stamp-off of an `&#160;` hotfix
  first. Ticket prose must not contradict HOTFIX_PATHS.

### D3 — behavior (docs drift) — blamed: coder

- **Evidence:** `docs/reference/Specification.MD` states
  `escapeHtml` emits `&#160;` (named `&nbsp;` not Telegram-allowed) —
  introduced with the same `7975ad98a` hitchhiker set — while the stamped
  production path still emits `&nbsp;`.
- **Failure class:** `behavior`
- **Remediation:** Align Specification with the stamped blob, or stamp off
  a real `&#160;` change separately. Do not fold uncertified doc rewrite
  into a BL-1093 land (BL-506 / BL-848).

### BLOCKED BY hitchhikers (not omitted)

- Property suite for BL-1113 stays green because HOTFIX_PATHS blobs were
  not rewritten — only the acceptance contract / docs drifted. Landing
  this tip would push a red stamp-off feature and contradictory docs onto
  `main` under a BL-1093 approval.
- Freshness-announce normalize files from the same merge are out of
  BL-1093 scope; left alone unless they block a gate (they did not this
  pass).

## Routing

Earliest owning role: **coder**. Keep BL-1093 nobody-assignee work; strip
or separately stamp-off the `7975ad98a` BL-1113 surface hitchhikers
(feature + done YAML + Specification) before re-forwarding. Parallel
restore tip `a966f0794` is a usable reference for the feature/board half.

By architect.
