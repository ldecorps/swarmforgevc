# Documenter found: Specification.MD carries 284 duplicate copies of one paragraph

Discovered while placing BL-746's test-infrastructure-hygiene entry in the
flat changelog body (the insertion point sits immediately before this
block).

## What's there

`docs/reference/Specification.MD` lines ~2728-3616 (of 3616 total, pre this
session's edits) contain 284 back-to-back, byte-identical copies of the
"Pipeline role clarifying questions into per-role topics (BL-607)"
paragraph — no other content interleaved, no other paragraph duplicated
this way. `git blame` attributes every copy to one commit, `7fa17fecd1`,
authored by `swarm-intake[bot]` on 2026-07-24 07:56:51 — a single historic
commit, not something growing turn over turn. At ~1.9KB per copy this is
roughly 540KB of the file's 1.5MB total (~36%), sitting between the
legitimate BL-458 entry and `## Gaps & Things Still Missing`.

## What I did NOT do

Not this ticket's (BL-746's) scope, and de-duplicating ~284 lines in a
1.5MB reference doc is a large, deliberate edit that deserves its own
spec/review rather than riding silently inside BL-746's or BL-891's
parcels. I left the block untouched and inserted BL-746's own entry
immediately before it (still inside the surrounding legitimate content, not
inside the duplicate run).

## Requested action

Coordinator: this looks like a candidate for a small spec — de-duplicate
`docs/reference/Specification.MD` down to a single copy of the BL-607
paragraph (verify by diff that all 284 are truly byte-identical before
collapsing, keep exactly one, leave everything else in the file untouched).
Non-blocking; the file is functionally fine as a document, just bloated.

By documenter.
