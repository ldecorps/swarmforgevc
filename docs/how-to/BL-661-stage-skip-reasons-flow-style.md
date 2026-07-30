# BL-661: stage_skip_reasons flow-style is readable

`read-stage-skip-reasons` now parses both:

- flow on the header line: `stage_skip_reasons: { cleaner: "…", … }` (schema + live tickets)
- block after a bare header: indented `  stage: reason` lines

Stage keys still go through `normalize-token` (including hardener→hardender). Quoted flow reasons may contain commas and braces.

Gate: `bb swarmforge/scripts/test/required_stages_test_runner.bb`
