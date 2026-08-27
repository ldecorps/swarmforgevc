# BL-658 — architect rematch pass — 20260826

- merge_and_process cleaner tip `f00c0c6660` (handoffd conflict → rematch
  side; BL-954 restore of trees deleted by prior BL-490 revert — paths now
  match tip).
- Prior bounce D1 (ceremonyDue log-only): **cleared**.

## D1 clearance

- `briefing-generation-sweep!` calls `night-closing-ceremony-run!` whenever
  gate mode is `ceremony` (not log-only).
- Pure `advanceNightClosingCeremony` drives freeze → drain/park →
  rotate/instruct → `.sent.json` confirm → night-stop.
- Impure runner `night-closing-ceremony-run.ts` applies those actions;
  `briefingSent` reads `docs/briefings/.sent.json`.
- Wiring script asserts both fixed-morning suppress **and**
  `closing-ceremony-run` invocation.

## Architecture / gates

- Pure fixture core + pure live SM under `quality/`; IO in tools CLIs;
  handoffd shells both gate and run.
- dependency-gate on parcel sources: **PASSED**.
- Units 23/23; properties (invariant / begin budgets) 2/2;
  `test_handoffd_closing_ceremony_gate_wiring.sh` PASS.

## Invariants

Declared invariant (briefing only as closing last act; no independent clock
on usable schedule): still encoded in `nightClosingCeremony.property.test.js`;
live path now produces the sequence instead of retiring 04:30 into silence.

Pass → hardender.

By architect.
