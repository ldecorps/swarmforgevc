# BL-1835 coder bounce response (2026-10-02)

Responding to QA bounce D1 (`backlog/evidence/BL-1835-QA-20261001.md`,
commit 719d56f82a).

## The defect

`briefing-instruction-note?` decided the addressee from `to:` LIST
MEMBERSHIP (`some #(= "documenter" %) (str/split (to) #",")`). For a
broadcast (`to: coder,documenter`), a real delivery stamps one physical
copy per named role - `recipient: coder` in coder's own inbox,
`recipient: documenter` in the documenter's - but `to:` keeps the FULL
list on every copy (handoff-protocol.md). The predicate therefore
exempted every copy of such a broadcast, including coder's, since
"documenter" sat anywhere in the shared `to:` text.

## The fix

`swarmforge/scripts/handoff_lib.bb`: `briefing-instruction-note?` now
decides from the per-copy `recipient:` header by EXACT match
(`= "documenter" (header-field file "recipient")`), never `to:`. A
missing `recipient:` (an untagged/legacy file) now stays HELD - fails
closed, unlike `mine?`/`stage-handoff-files`' own "untagged passes"
convention, since this is a narrow allowlisted pause-hold bypass rather
than a general inbox filter (QA's own remediation pointer said this
explicitly).

## Everywhere the broadcast/recipient shape now has coverage

- `swarmforge/scripts/test/handoff_lib_test_runner.bb`: the BL-1835
  block's `note-content` helper now writes `recipient:` on every
  fixture; added the exact D1 shape (`to: coder,documenter`,
  `recipient: coder`, the real briefing text) as a candidate that must
  stay held, and a separate case for a missing `recipient:` header
  (fails closed). Re-ran: `handoff_lib (BL-365): ALL TESTS PASSED`.
- `specs/pipeline/steps/lib/bl1835CeremonyBriefingPassesItsPauseCli.bb`:
  every candidate it builds now carries `recipient: <role>` (the inbox
  it's placed in) alongside `to:`, matching a real delivered file. The
  broadcast `to:` shape itself is covered at the unit level above, since
  the fixed predicate never reads `to:` at all.
- `extension/test/bl1835PauseExemptsBriefingInstructionInvariant.property.test.js`:
  the candidate generator gained a `broadcast-briefing` kind - the real
  instruction, `to:` naming the copy's own recipient PLUS one other
  drawn role, `recipient:` naming only the one role this physical file
  belongs to. Exempt iff `recipient === 'documenter'`, independent of who
  else is named in `to:`. Added a reach-floor assertion that a
  non-documenter broadcast copy staying held was actually drawn at least
  once. The non-vacuity test now swaps the fixed `recipient:`-exact-match
  clause for the ORIGINAL `to:`-membership bug (not a synthetic mutation)
  and confirms it wrongly serves the coder's own copy of a
  `to: coder,documenter` broadcast - the exact D1 regression shape.

## Re-verification (same procedure as the original pass)

- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb`: ALL TESTS
  PASSED.
- `node specs/pipeline/cli.js` BL-1835 feature and
  `run_acceptance.sh`: 6/6, both ways.
- Sibling features: BL-1740 4/4, BL-1458 6/6.
- `npm test`: 646 files, 10995 tests, all green.
- `npm run test:properties`: 495 files, 1397 tests, all green (clean
  this time - no step-collision repeat, nothing else regressed).

Nothing else in QA's gate table (pre_qa_gate, standing-red register,
docs currency, wiring to live callers) is affected by this fix - it
narrows the SAME predicate QA already exercised through every one of
those gates once.
