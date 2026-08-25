# BL-828 — cleaner pass — 20260825

- Tip-pure: cherry-pick coder tip `8ef108d81e` onto `origin/main` only
  (ancestor chain hitchhiked BL-1079/1117 closes + dels=1). Resolved
  active YAML add/add; `dels_on_origin=0`, 8 paths.
- DRY: `armDoubleTapWindow` in BubbleGestureDecider; shared
  `timerRunnable` in OverlayService attachDrag.
- JVM unit tests not run here — JAVA_HOME unset on this host (degraded;
  coder/hardener own .kt suite).

By cleaner.
