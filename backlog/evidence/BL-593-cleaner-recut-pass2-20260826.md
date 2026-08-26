# BL-593 — cleaner re-cut pass 2 — 20260826

- merge_and_process QA bounce `7e07b43a80` (D1: polluted bounce carried
  BL-779/784/980 stack on forward `efa00ce100`).
- Re-cut from `origin/main` @ `3855d721e`: BL-593 mutation telemetry slice
  only (12 paths vs main, zero sibling hitchhikers).
- Verified: mutation telemetry unit tests — 21/21 PASS.

By cleaner.
