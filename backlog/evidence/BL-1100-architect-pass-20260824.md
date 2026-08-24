# BL-1100 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `fc91b3954b` (on coder `7aaf51f70f`) into
`swarmforge-architect`. Merged cleanly; ancestry confirmed.

## Scope

Delete `is_do_not_promote` prose grep from `promote_and_route_next.sh`.
Candidacy uses only structured gates (`type: epic`, `status: blocked`,
then `promotion_gates_cli`). Auto-pick skips announce `skip <id> gate=…`.
`--list-candidates` for inspection. True parks BL-553 / BL-828 re-expressed
as `status: blocked` (prose left verbatim). BL-556 already in `done/` — no
re-park needed.

## Architecture

- Matches approval recommendation: delete the prose check; `is_epic_type`
  already covers the stated epic purpose.
- Silent `continue` replaced with `announce_skip` — restores observability
  (invariant 2).
- Parks survive as structured `blocked` without rewriting human sentences
  (invariant 3).
- Cleaner: `is_buildable` reuses `ticket_id_of` (DRY).
- Shell-only policy change; no webview/host/secrets; stamp-off tip hygiene
  OK (`27273f2b0a`, BL-1113 9/9).

## Required hard gate

`node extension/out/tools/dependency-gate.js test/bl1100PromotionProseNeverBlocks.property.test.js`
→ PASSED. No new `extension/src` production edges.

## Invariants review (BL-633/BL-654) — 3 declared; 2 encoded in properties + all in acceptance

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | No prose disqualification | property + feature Outline | Green |
| 2 | Skips announce id + gate | property + feature | Green |
| 3 | Human parks still refused; prose survives | feature park scenarios; YAML status:blocked | Green |

## Property-testing support (undeclared)

Declared 1–2 covered (2/2). Invariant 3 is acceptance/YAML; no gap worth a
vacuous third property.

## Correctness read-through

- Acceptance 8/8; properties 2/2.
- Live `--list-candidates` emits `skip BL-553 gate=blocked` (and epics).
- No prior BL-1100 bounce evidence.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose`,
commit = this evidence commit (BL-536 / BL-806).

By architect.
