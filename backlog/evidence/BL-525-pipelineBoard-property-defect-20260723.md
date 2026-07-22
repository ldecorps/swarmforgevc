# Pre-existing pipelineBoard.property.test.js defect — needs own ticket

Flagged by QA's BL-525 bounce evidence (`backlog/evidence/BL-525-bounce-20260722.md`)
as unrelated to BL-525 and needing its own ticket. Confirmed by architect during
BL-525's post-bounce re-review (2026-07-23): the failing test file is byte-identical
between this branch and `origin/main`, so the bug is pre-existing/shipped, not
introduced by BL-525.

## Failing property
`extension/test/pipelineBoard.property.test.js` — "the included links are always
an in-order PREFIX of the full ordered list" — fails via `npm run test:properties`.

## Root cause (per QA's diagnosis)
Introduced by commit `d63e80320` ("Cap pipeline board parked list at 10 by
priority and shorten link HTML"), which changed `pipelineBoardLinkLine`'s output
format from `"${id}: <a...>"` to a bare `<a...>${label}</a>` anchor without
updating the property test's `${id}:` substring assertions.

## Action needed
Specifier: file a new ticket to fix either the property test's assertion (if the
new anchor format is intentional) or `pipelineBoardLinkLine` (if the id prefix
was meant to stay). Does not block BL-525.
