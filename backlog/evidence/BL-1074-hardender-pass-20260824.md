# BL-1074 — hardender pass — 20260824

## Inbound

Architect tip `ba9b702c09`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip.

Hitchhike gate before handoff → CLEAN.

## Scope

`lastCycleBoundsMs` copy-close fallback uses the Add’s `step.timeMs` as the
close (not `newestAtDone`), after walking done/→done/ re-files. Hardened
activation lookup: a reopen between close and re-file must not steal the
closed cycle’s activation.

## Host / cooldown

`mutation_cooldown_gate.bb` absent on this tip (degraded). Soft Gherkin
**2/2** killed. Surgical below.

## Harden locks

- Unit: post-close reopen before done/ re-file still measures 5h to the Add.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| close at newestAtDone (re-file tip) | killed |
| skip done/→done/ walk | killed |
| activation lookup uses newestAtDone time | killed |

Survivors: 0.

## Verification

- Unit (`meanTicketTimeWalk.test.js`) **10/10**
- Properties **3/3**
- Acceptance **5/5**

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-1074-post-close-refile-inflates-measured-ticket-duration`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
