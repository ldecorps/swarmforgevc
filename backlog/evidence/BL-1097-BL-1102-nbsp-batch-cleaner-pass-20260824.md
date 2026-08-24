# Batch bounce re-fix cleaner pass — 2026-08-24

Covers three coder tips merged in one cleaner batch:

| Task | Coder tip | Bounce class |
|---|---|---|
| `telegram-board-nbsp-reapply` | `39435d8721` | architect Spec/done &#160; narrative |
| `BL-1102-bounded-sh-throws-on-spawn-failure` | `332e9d4885` | stamp-off hitchhikers |
| `BL-1097-the-router-re-routes-a-ticket-that-has-already-been-worked` | `62072c5f0a` | steps index re-register |

## Checks

- HOTFIX_PATHS `cursor-forge.conf` / `pipelineBoard.ts` == `27273f2b0a`
- BL-1113 acceptance 9/9
- BL-1102 acceptance 6/6 + daemon_cycle_guard unit ALL PASS
- BL-1097 acceptance 4/4

## Cleanup

- Deduped duplicate `bl1097RouterNoOpOriginationSteps` require left by merging
  the strip tip (removed registration) with the re-register tip (appended
  again). One registration remains.

## Findings

NONE per ticket beyond the index dedupe.

By cleaner.
