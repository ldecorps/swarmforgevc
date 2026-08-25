# BL-1146 — cleaner pass — 20260825

- merge_and_process coder tip `882c8f6272` (clean cherry-pick).
- enqueueNextPromptId pin while busy; `decideIdleQueueTransition` holds on host
  question. Core helpers + Live wiring; feature + APS steps included.
- Tests: `node --test extension/test/bl1146HostQueueEnqueueNext.property.test.js`
  6/6 pass. `dels_on_origin=0`.

By cleaner.
