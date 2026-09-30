# BL-1817 - QA unowned-red hold, 2026-09-30

Parcel: documenter ba7cbe5c6e, merged into QA as c309e3f02f.
parcel_commit: c309e3f02f

BL-1817's own gates are green; approval is withheld under Article 4.2
because the property lane carries one red file with no open owner. The
parcel does not touch that file; it is not bounced.

## Unowned red (no row in backlog/standing-reds.tsv, no open ticket)

red: extension/test/bl1754PeerQuestionInvariants.property.test.js
  Failure line NOT captured: qa-gather's excerpt is bounded and does not
  reach this file's FAIL block; its register_join (parsed from the whole
  output) names the file as failing. Not re-run as a lane.
  Solo run of this one file on the same tree (tmp/BL-1817-bl1754.log):
  8/8 pass in 25668 ms; "invariant 1 (timed-out)" 9235 ms, "answered"
  4714 ms, "refused" 4932 ms - subprocess-heavy, the shape of the
  lane-contention timeouts BL-1808/BL-1814 fixed. The owner's reproduction
  must capture the lane message.
  Owner grep: BL-1754 (closed, landed d9285a11ca) is the only ticket naming it.

## BL-1817's own gates (all on c309e3f02f, one run each)

- qa-sibling-check status: VERIFY BL-1817.
- pre_qa_gate.sh (required_wiring): OK.
- Unit (npm test): exit 0.
- Acceptance: 5/5 ok.

By QA.
