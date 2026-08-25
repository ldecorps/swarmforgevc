# BL-695 hardener pass — rematch tip (supervisor ≠ front-desk topics)

**Architect tip:** `5a4840154e`
**Hardener tip:** (this commit)
**Task:** `BL-695-supervisor-threads-are-not-front-desk-topics`

## Gates

| Gate | Result |
|------|--------|
| Unit `topicThreadKind.test.js` | 16/16 |
| Properties | 3/3 |
| APS | 7/7 |
| Soft Gherkin stamp | Outline 3/3 killed (present) |

## Surgical (restored)

| Mutant | Unit | Prop | APS | Verdict |
|--------|------|------|-----|---------|
| `mayWriteTrackedTopicRecord` always true | fail | fail | fail | killed |
| SUP-* classified as ticket | fail | fail | fail | killed |
| unbound classified as ticket | fail | pass | fail | killed |

## Product

`extension/src/concierge/topicThreadKind.ts` + store/bot wiring — fail-closed
tracked writes; supervisor icon memory under `.swarmforge/`.
