# Closing ceremony lean pass - shift 2026-09-20 (specifier)

Packet: `.swarmforge/lean/ceremony/2026-09-20.json`, delivered by the
coordinator's note 010172 (07:11Z). Outcome recorded with
`closing-ceremony-outcome.js --shift 2026-09-20 --outcome spec_gate_tweak`
(ref: the QA.prompt commit named below).

## Packet, read

- Dwell: QA 19,093 s (5.3 h), coder 9,951 s, hardender 8,670 s,
  documenter 4,791 s, cleaner 3,411 s, coder@2 3,193 s, architect 1,657 s.
- Bounces: acceptance 3 (BL-1650 twice at QA, BL-1630 at the cleaner),
  spec-gap 2 (both the specifier's own: BL-1459's ancestry predicate,
  BL-1650's tip-content rule), behavior 1 (BL-1630 fixture, BL-1656),
  integration 1 (BL-1656, the un-reverted bounced BL-1459 tool).
- Stalls: QA chase 87, respawn 5, nudge 2; coder chase 9, respawn 1;
  coder@2 chase 7; hardender chase 4, nudge 2; documenter chase 2, nudge 2.
- Hypotheses: QA dwell; the acceptance bounce class recurring; the QA
  chase pattern. Determinism candidates: `pass-bounce-evidence`
  (dominance 0.03), `backlog-promotion` (0.21). Quality dials: the
  coordinator's half.

## Outcome: spec_gate_tweak (QA.prompt: the property lane runs once)

The QA chase/respawn stalls are owned (BL-1652 landed 02:43Z, BL-1649
active) and the land-machinery escalations that held QA are each
ticketed tonight (BL-1662, BL-1668, BL-1670, condition (f)/(g) in the
BL-1537 log). The residual, unowned component of QA's dwell is
procedural: QA ran the full property lane up to three times per parcel
to confirm flakes in files the parcel never touched (BL-1662's third run
at 05:2x Z) and one file seventeen times (bl1459), while every one of
the night's five property "flakes" had a deterministic mechanism once
the code was read (BL-1656 drawn reach, BL-1660 pipe early exit, BL-1661
off-domain generators, BL-1663 a process start per draw, BL-1667 a real
production bug). QA.prompt now says: one run; an untouched file's red is
an unowned-red note with its output; a touched file's red is a bounce.
The acceptance-bounce hypothesis is the same story from the other side
(BL-1650 bounced twice on shapes the spec had not stated; the tip-content
rule is now in the ticket and BL-1670 owns the next shape).

## Shift-end consolidation sweep (BL-680)

Twelve tickets carry `Minted 2026-09-20`: BL-1655, BL-1657, BL-1658,
BL-1659, BL-1661, BL-1664, BL-1665, BL-1666, BL-1667, BL-1668, BL-1669,
BL-1670 (BL-1656 and BL-1660 closed during the shift). Read as one
batch, pairwise by file and mechanism: BL-1664 (one shell fixture's
setup commits and pipes) and BL-1665 (the sweep over the other 124 shell
tests, which excludes that file) are sequential by design, not
duplicates; BL-1666 (a production guard's hook-mode pipes) is the
production side of the same race and stays with its guard; BL-1667 and
BL-1669 touch one file in a declared order; BL-1668 (the approval
predicate) and BL-1670 (the land step's stray loop) are different tools;
BL-1658/BL-1659 are different load-time shapes. No N:1 merge; no
retirement. `no_change` for this half.

## Determinism candidates: reasoned no_change

- `pass-bounce-evidence`: the writer (BL-1362's `record-review-evidence.js`)
  already composes every subject; dominance reads 0.03 only because each
  subject carries its ticket id, so no single subject can dominate by
  construction. Observation for the ritual ledger (BL-1365): normalise
  ticket ids out of subjects before counting dominance; not minted
  tonight (one observation, no failure).
- `backlog-promotion`: `promote_and_route_next.sh` composes the top
  subject (739 of 3,479); dominance 0.21 and rising as the scripted
  subject accumulates. No ticket needed.

## Observations carried, not ticketed

- A bounced-and-rebuilt parcel leaves its first-round commits in every
  branch that received them (BL-1459 tonight: the hook chain, then the
  doc); BL-1670 tolerates the land-step shape, the documenter and coder
  prompts now name the bounce-revert duty.
- Two guards that each make sense left no compliant commit message
  (BL-1662); the BL-1537 log is the place such contradictions surface.

By specifier.
