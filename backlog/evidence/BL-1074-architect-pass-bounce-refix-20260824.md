# BL-1074 — architect pass (bounce rematch) — 20260824

## Review inventory (Article 4.4)

NONE. Prior D1 (copy/Add close fallback ended at `newestAtDone`) closed by
`d25c29df4`: fallback uses `step.timeMs` after walking done/→done/ re-files,
with activation looked up strictly before that close.

## Inbound

Cleaner rematch tip `94dbe81315` (hitchhike-free rebuild of rename-path +
copy-close fix). Architect **recreated** `swarmforge-architect` on this tip.

Hitchhike gate → CLEAN (6 paths).

## Architecture

`lastCycleBoundsMs` returns both ends of the last active→done cycle from
the shared BL-1066 walk (no new git subprocess). Rename-hop closes use the
active→done hop; copy/Add closes use the dead-end Add under done/, not a
later re-file tip. Declared invariants covered by property tests; copy-close
+ re-file pinned in unit (9th case). Repro after fix: copy-close + re-file
→ `meanMs === 5h` (was 49h).

## Gates

| Gate | Result |
|---|---|
| Compile | OK |
| Unit (`meanTicketTimeWalk.test.js`) | **9/9** |
| Properties (`bl1074…property.test.js`) | **3/3** |
| Acceptance (BL-1074) | **5/5** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `hardender`, priority `00`, task
`BL-1074-post-close-refile-inflates-measured-ticket-duration`.

Hardender (and later roles): recreate the role branch on this tip; do not
merge into hitchhiked ancestry.

By architect.
