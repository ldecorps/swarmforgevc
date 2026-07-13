# BL-317 QA bounce evidence — 2026-07-13

## Failing command
```
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-317-ticket-routing-manifest-field.feature
```

## Commit hash
`b49e443b3e` (documenter's forward; underlying implementation from coder commit
in this chain, hardener fix `9a6dcb2c3f`)

## First error excerpt
```
# Subtest: a block-style roles: list is read back as declared
not ok 3 - a block-style roles: list is read back as declared
  error: 'Scenario "a block-style roles: list is read back as declared": no step
  handler matched "Given a ticket YAML declaring a block-style roles: list of
  coder and QA"'

# Subtest: a present-but-unreadable roles: field is rejected, not treated as absent
not ok 4 - a present-but-unreadable roles: field is rejected, not treated as absent
  error: 'Scenario "a present-but-unreadable roles: field is rejected, not treated
  as absent": no step handler matched "Given a ticket YAML whose roles: field is
  present but cannot be parsed"'
```
(The other 4 scenarios pass cleanly on a fresh `npm run compile` — not a
stale-build artifact, and not a regression in the original scope.)

## Failure class
`behavior` — scope item 4b of the ticket ("ABSENT AND UNREADABLE MUST NOT BE THE
SAME ANSWER") was never implemented, not merely untested.

## Expected vs observed
Expected: `parse-roles-field` accepts BOTH flow-style (`roles: [coder, QA]`) AND
block-style (`roles:\n  - coder\n  - QA`) lists — this schema's own established
convention for multi-item fields (`acceptance.steps:` uses block style; only
`depends_on:` is flow-style) — and a `roles:` field that is PRESENT but cannot be
parsed in any supported form is a validation ERROR rejected before promotion,
never a silent fall-through to the full chain.

Observed: verified directly in `swarmforge/scripts/routing_manifest_lib.bb` —
`parse-roles-field` only recognizes a flow-style `[...]` value; a block-style
list, or any other unparseable form, falls through and returns `nil`, and
`read-roles` treats ANY `nil` (genuinely-absent OR present-but-unparseable) as
"default to full chain." `validate-roles` only ever runs on a list that
successfully parsed, so a malformed manifest is never rejected — it just looks
absent, silently discarding the specifier's narrowing intent with no error.

## Root cause (why this happened, not just what broke)
Same class of gap as BL-325's bounce (see `bl325-human-in-the-loop-closed-bounce-
20260713.md`): the specifier amended this ticket AND its feature file on `main`
(commit `a8b0695`, "a present-but-unreadable roles: manifest must be rejected,
not silently ignored") after an architect review of an earlier build found the
exact fall-through-to-full-chain bug. That amendment added mandatory scenarios
`routing-manifest-field-05`/`-06` and scope item 4b. The coder/hardener/documenter
chain that produced this delivered commit never merged `main` to pick it up —
confirmed via `git merge-base --is-ancestor a8b0695 b49e443b3e` (false). The
architect who reviewed THIS build independently rediscovered the identical gap
(per QA's own memory of that review) but filed only a `rule_proposal`, apparently
unaware a formal, mandatory amendment with named scenarios already existed for it
on `main`.

Note: this build's own hardener commit (`9a6dcb2c3f`) DID fix a real, separate,
unrelated bug in the same function (a notes-block collision misreading the
ticket's own example text as a real `roles:` field) — that fix is correct and
should be kept, not reverted.

## What to fix
1. Merge `main` (picks up `a8b0695`'s scenarios 05/06 and the amended ticket notes).
2. Make `parse-roles-field` accept block-style `roles:` lists (`- role` lines),
   not only flow-style `[...]`.
3. Distinguish "absent" from "present but unparseable" — only a genuinely absent
   field may default to the full chain; anything else must be a validation error.
4. Wire scenarios `routing-manifest-field-05`/`-06`'s step handlers in
   `specs/pipeline/steps/routingManifestFieldSteps.js`.
5. Keep hardener's notes-block-collision fix (`9a6dcb2c3f`) — unrelated and correct.
