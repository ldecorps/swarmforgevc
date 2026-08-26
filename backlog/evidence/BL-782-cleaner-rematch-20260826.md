# BL-782 — cleaner rematch — 20260826

- merge_and_process coder tip `51919acd64` (QA bounce D1 rematch).
- Resolved evidence conflicts (kept first-pass cleaner notes + rematch tip).
- Flattened `killChild`; DRY `assertProbeAliveState` for count/not-count steps.
- Decoy lifecycle (module `liveDecoys`, `unref`, `afterEach`) left as coder
  delivered — clears QA D1 hang class.
- D2 (mutation caches) is hardener-owned; not in this tip's step changes.

By cleaner.
