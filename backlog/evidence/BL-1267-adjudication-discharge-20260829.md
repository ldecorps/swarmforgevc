# BL-1267 — the discharge path, built and measured

Coder, 2026-08-29. Evidence for the `qa_e2e_procedure`, and the record of the
two implementer calls the ticket left open.

## The two calls the approval context asked me to make

**(1) Fingerprinted, not a per-ticket allow-list.** Kept as specced. An
adjudication is bound to a SHA-256 of the exact ticket text it was made
against; amend the ticket by one character and the gate re-arms with a reason
naming the stale record. It is more work for the specifier than the cheap
version, and it is the property most likely to be lost to a convenient
implementation, so it is the one both a scenario and a property test pin.

**(2) The record lives OUTSIDE the ticket**, at
`.swarmforge/deprecator/adjudications/<BL-ID>.json`. Two reasons, the second
decisive: gate state does not belong in a human-edited artifact; and an
adjudication necessarily discusses the deprecation vocabulary that earned the
hold, so writing it INTO the ticket would arm the generic-claim branch against
the very ticket it just cleared. That is the trap the ticket's own description
names, and BL-1268 narrowing the branch reduces it without removing it.

Record shape:

```json
{
  "ticket": "BL-1256",
  "outcome": "confirm_promote",
  "adjudicated_by": "specifier",
  "adjudicated_at": "2026-08-29T12:00:00.000Z",
  "content_fingerprint": "<sha256 of the ticket YAML>"
}
```

## Writer and reader ship together

`extension/src/tools/record-adjudication.ts` is the writer; deprecate-check.ts
is the reader. The ticket's size-envelope justification is explicit that
splitting them would ship a dark path (BL-298 / BL-1273's defect class), so
they are one commit. The writer fingerprints the ticket through the reader's
own `findTicketYamlPath` + `computeTicketFingerprint`, rather than carrying a
second copy of either — a writer whose fingerprint the reader cannot verify is
the failure the split would have invited.

The writer **refuses** a ticket it cannot find rather than writing a record
with an empty fingerprint that could never match.

## qa_e2e walked

| step | result |
|---|---|
| 1. held fixture → record confirm_promote → allow, naming the record | pass — the allow reads `discharged by adjudication <path>: confirm_promote by specifier at <iso>` |
| 2. non-vacuity: same fixture with no record | pass — holds with `ticket claims itself superseded-by in field 'closed_as' without a backlog/done/ closure` |
| 3. amend one character after adjudicating | pass — holds, `no longer matches the ticket content it was made against (recorded 111da21edf91, ticket is now c3b4a87789fd) — re-adjudicate` |
| 4. amend / retire / split outcomes; truncated JSON; `[]`; `null`; missing fields; wrong ticket id; unknown outcome | pass — every one holds; a corrupt record holds as `unusable adjudication record <path>: <problem> — fail closed`, never as absent-and-clean |
| 5. real `promote_and_route_next.sh` against a fixture root | pass — `active/` with the adjudication, `paused/` without; asserted on the file's location, and on the live mailbox being untouched |
| 6. grep the diff for a bypass | pass — no environment variable, flag, or argument produces an allow; see below |

## Step 6, in full

`git diff` over `deprecate-check.ts`, `record-adjudication.ts` and
`promote_and_route_next.sh` for `process.env`, `getenv`, `SKIP`, `FORCE`,
`BYPASS`, `--allow`, `argv[`: the only hit is the word "bypass" inside a
comment explaining why there is not one. `record-adjudication.ts` reads no
environment at all.

That is also pinned executably, not just grepped: a property sets
`DEPRECATE_CHECK_SKIP`, `SWARMFORGE_SKIP_DEPRECATE_CHECK`,
`DEPRECATOR_FRESHNESS_FORCE_RESULT`, `SWARMFORGE_FRESHNESS_ALLOW` and
`FORCE_PROMOTE` to plausible truthy values and asserts the decision is byte-
identical to the decision without them.

## One in-scope change outside the CLI

`swarmforge/scripts/promote_and_route_next.sh` resolved the freshness CLI path
TWICE: `deprecate_check_cli()` searched `$ROOT` then fell back to the script's
own repo, but the `interpretFreshnessCliOutput` call below it hardcoded
`"${ROOT}/extension/out/tools/deprecate-check.js"`. Against any root that is
not this repo itself — every fixture root, and any target project — the check
ran correctly and the interpreter then failed closed on a missing module,
producing `interpretFreshnessCliOutput failed — fail closed`: a hold no
adjudication could ever discharge, blamed on the interpreter rather than on the
path. Scenario 06 is unsatisfiable while that stands, so the two call sites now
share one `resolve_deprecate_check_cli`. No gate, signal, or fail-closed
posture changed.

Confirmed not a regression from this parcel:
`test_bl1028_promotion_obeys_integrity_refusal.sh` and
`test_promote_and_route_next_no_limit_depth.sh` fail identically at the
merge-base commit with the original script restored (checked both ways).

## Not done, deliberately

No currently-held ticket was discharged. Clearing the live backlog is
adjudication work for the specifier, ticket by ticket under Article 3.6; this
parcel ships the mechanism only, per the ticket's own firm line. The specifier
can now clear BL-1256 with:

    node extension/out/tools/record-adjudication.js . BL-1256 confirm_promote specifier

## Invariants

Both are executable, in
`extension/test/deprecateAdjudicationDischarge.property.test.js`, with
asserted reachability floors and constructed (not hoped-for) fingerprint
matches — the interesting state here is the MATCH, which independently drawn
texts reach essentially never, so the fingerprint is derived from the drawn
ticket by the same transformation the code uses and the mismatch is made by
amending it afterwards. Both were shown to fail against deliberately broken
implementations (fingerprint check disabled → "an amended ticket rode a stale
clearance"; outcome check disabled → "retire discharged a hold") and restored.

## Suite

Unit 64/64 across the four deprecate suites; acceptance 10/10. Full unit suite
unchanged from the post-BL-1220 baseline: 20 failing files, 33 failing tests,
none of them this parcel's (`constitutionDocCitations` cites `docs/deprecated/`
and is one of the pre-existing repo-hygiene reds).
