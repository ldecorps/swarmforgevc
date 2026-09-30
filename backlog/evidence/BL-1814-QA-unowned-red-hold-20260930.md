# BL-1814 - QA unowned-red hold, 2026-09-30

Parcel: documenter 3498fa7dc3, merged into QA as 1a55ebcf4d.
parcel_commit: 1a55ebcf4d

BL-1814's own gates are green; approval is withheld under Article 4.2
because the property lane carries one red file with no open owner. The
parcel does not touch that file; it is not bounced.

## Unowned red (no row in backlog/standing-reds.tsv, no open ticket)

red: extension/test/draftPathUnder.property.test.js
  > draftPathUnder property: the draft directory depends only on root, never on TMPDIR (BL-1537 invariant 1)
  Error: Property failed after 67 tests
  { seed: -957004781, path: "66:0:0:0:0:9:9", endOnFailure: true }
  Counterexample: [" "," ",".."," "]
  Shrunk 6 time(s)
  (test/draftPathUnder.property.test.js:20:8)
  A shrunk counterexample with a seed: a real generator-reachable input
  (a ".." path segment), not a timeout. Replay with that seed.
  Owner grep: only closed-ticket evidence (BL-1537, BL-1550, 09-12 ceremony).

## BL-1814's own gates (all on 1a55ebcf4d, one run each)

- qa-sibling-check status: VERIFY BL-1814.
- pre_qa_gate.sh (required_wiring): OK.
- Unit (npm test): exit 0.
- Acceptance: 9/9 ok.
- bl1052LocalModelSeat.property.test.js passed in the lane run; run
  counts (80/16) and the 180000 ms spawn timeout unchanged; the vitest
  budget is propertyLaneTimeoutMs(20000), the FIRM 20 s floor.

By QA.
