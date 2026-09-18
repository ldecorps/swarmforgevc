# Docs duplicate-paragraph guard (BL-693)

*How-to. Task-oriented: understand what the standing docs-duplication
assertion checks, why a failure looks the way it does, and how to
reproduce it by hand.*

## What it catches

`extension/test/docsDuplicateParagraphGuard.test.js` scans every markdown
file under `docs/` and fails when the same trimmed, *substantial* line
appears more than once inside one file. "Substantial" means longer than
`DEFAULT_THRESHOLD` (200 characters) — short structural lines (code
fences, horizontal rules, table separator rows, list markers, blockquote
markers, box-drawing diagram lines) are always exempt by construction,
with no per-file or per-paragraph allowlist. Only within-file repetition
counts: the same line legitimately restated across two different docs
files is not a finding.

It rides the extension Vitest suite every parcel already runs, rather than
being a step a role must remember to invoke — the same posture as
`tmpDirMigrationGuard.test.js`. `docs/reference/Specification.MD` carried
286 copies of one paragraph (BL-692) for 17 days and ~25 documenter passes
before anything objected; this is the assertion that would have caught it
in the parcel that introduced it.

## Reading a failure

A finding names the file, the truncated repeated text, the occurrence
count, and every line number it appears on (`helpers/docsDuplicateParagraphGuard.js`'s
`formatFinding`) — enough to act without opening the full file.

## Reproducing it by hand

1. Paste any long paragraph (over 200 trimmed characters) from a docs file
   a second time into that same file.
2. Run the extension suite (or just this test file):
   `npx vitest run test/docsDuplicateParagraphGuard.test.js` from `extension/`.
3. It goes red, naming the file, the duplicated text, and both line numbers.
4. Remove the paste; it goes green again.

## First catch (2026-09-18)

The specifier's own freshness scan while writing this ticket's promotion
note found two accidental duplicates already on the tree — each an
index bullet appended twice by separate parcels: the BL-1370 how-to entry
in `docs/index.md` (added by two commits on 2026-09-05) and the BL-1056
how-to entry (added by two commits on 2026-09-02). The second copy of each
was removed as part of this same parcel, so the real-tree scenario is
green with no exemption list.

## Scope

- Exact line match only — no fuzzy/similarity matching (a false-positive
  risk over a corpus that legitimately repeats boilerplate).
- `docs/` only. Prose elsewhere (role prompts, constitution articles) is
  out of scope for this ticket.
- Not wired into `swarm_handoff.sh` or a commit hook — it runs as part of
  the test suite, not the transport layer.

See `backlog/active/BL-693-repeated-paragraph-gate.md` for the full spec
and `specs/features/BL-693-repeated-paragraph-gate.feature` for the
acceptance scenarios.
