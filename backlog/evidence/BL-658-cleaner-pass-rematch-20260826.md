# BL-658 — cleaner pass (live-sequence rematch) — 20260826

- merge_and_process coder tip `a99ac393fb` (architect bounce D1: ceremonyDue
  was log-only; rematch wires `night-closing-ceremony-run` from handoffd).
- DRY: `tick` helper in `nightClosingCeremonyLive.test.js`.
- Kept `node:test` (8 live + 2 run + prior suites green). Wiring script now
  asserts run invocation. No restage of `extension/src` (BL-1124).
- Applied ticket lens: live path freezes → drain/park → instruct →
  `.sent.json` → night-stop; not a logging-only nit.

By cleaner.
