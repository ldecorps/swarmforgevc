# Brief: Model scout list items don't bold their leading model-name token

**Artifact**: Daily briefing email — Model scout section (BL-1822, pasted
verbatim into `docs/briefings/<date>.md`, rendered through the same HTML
pipeline as the rest of the briefing)
**Surface**: phone mail client, ~390px viewport
**Reviewed**: 2026-10-01, QA sign-off sample
`.worktrees/QA/tmp/BL-1822-rendered-sample.txt` (pre-land, text output of
`recruiter_score_table_cli.bb --briefing`)

## What's wrong, as a human sees it

```
Model scout:
- qwen2.5-coder-14b-q5km — 9/10 (incumbent)
- qwen3-coder:30b-IQ4_XS — 7/10
- qwen3-coder:30b-Q3_K_M — 5/10
Recommend: keep qwen2.5-coder-14b-q5km
```

Each list item's leading identifier — the model name a reader scans for —
sits in plain body weight, identical to the already-ruled defect this
system fixed for ticket IDs in "Business features delivered"
([2026-09-06 brief](2026-09-06-briefing-list-item-scan-weight.md), ruled
in `docs/design/system.md`: "List items needing to be scanned by a
leading identifier ... bold that identifier token"). A model name is
exactly that kind of identifier — a reader checking "did the incumbent
still win?" or "how did IQ4_XS do?" has to read every character of every
line instead of catching the model name by weight.

## Intended result

The leading model-name token in each row is bolded, matching the existing
rule: `- **qwen2.5-coder-14b-q5km** — 9/10 (incumbent)`. Verify on the
surface: scanning the rendered section at phone width, a reader can find
"qwen3-coder:30b-IQ4_XS" by its visual weight alone before reading the
score after it.

## Constraints

- This is markdown pasted verbatim by the documenter per BL-1822's spec —
  the bolding has to come from the CLI's own output (`**model**` in the
  emitted markdown), not a post-hoc render-time rule, since the
  documenter never edits the pasted block.
- The two empty-state lines ("Model scout: no scout has run yet." / "...
  no new scout since the previous briefing.") are plain sentences, not
  list items — unaffected, no bolding needed.
- The `Recommend:` line is a sentence, not a scanned-by-identifier list
  item — unaffected per the existing rule's own scope (group-intro
  sentences stay bold-as-sentence, not changed here).

## Disposition

No new design rule — this is the 2026-09-06 scan-weight rule applied to
a new artifact section that didn't exist when that rule was ruled. Not a
brief for the specifier to mint standalone: BL-1822 is still active,
pre-land, with QA holding sign-off on this parcel — routed back to QA as
a defect on the existing ticket (Article 4.3: QA bounces to the role
that owns the fix, the recruiter_score_table_cli.bb rendering).
