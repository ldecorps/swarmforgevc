# BL-661: stage_skip_reasons flow-style is readable

`read-stage-skip-reasons` now parses both:

- flow on the header line: `stage_skip_reasons: { cleaner: "…", … }` (schema + live tickets)
- block after a bare header: indented `  stage: reason` lines

Stage keys still go through `normalize-token` (including hardener→hardender).
Quoted flow reasons (double or single) may contain commas and braces.

Return shape (BL-754): `{:reasons {stage → reason} :malformed nil-or-string}`.
An unquoted reason whose comma is **not** the boundary before the next
`stage:` is present-but-malformed — surfaced on the routing-skip record, never
returned as a silent partial map. See
`docs/how-to/BL-754-stage-skip-reasons-never-silently-loses-a-stage.md`.

Gate: `bb swarmforge/scripts/test/required_stages_test_runner.bb`
