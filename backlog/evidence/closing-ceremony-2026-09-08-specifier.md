# Closing ceremony — shift 2026-09-08 (specifier lean pass, BL-820)

Packet: `.swarmforge/lean/ceremony/2026-09-08.json`, delivered 00:00Z, read
via a coordinator `note` (priority 00) at 04:26Z.

**Outcome recorded: `spec_gate_tweak`, ref `dce5e90739`.**

## What the packet showed

Path taken: cleaner → architect → hardender → documenter → coder → QA (the
coder re-entry is the bounce below). Five closes (BL-1408, BL-1476, BL-1471,
BL-1348, BL-1445). Dwell hotspots QA 7024514ms and hardender 6530429ms.
One bounce, class `behavior`. Four chases: documenter ×1 (BL-1477), coder ×1
each on BL-1474, BL-1476, BL-1471.

## The signal I acted on

The shift's **only** bounce (`backlog/evidence/BL-1445-architect-bounce-20260908.md`,
architect → coder, class `behavior`, commit `5ebca5d530`): BL-1445's scenario
02 derived its population — "every shell test under `swarmforge/scripts/test`
that sources swarmforge.sh" — with a regex requiring the literal path
immediately after `source`. 21 of the 23 real tests reach the launcher through
`SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"`, the ticket's own principal
file among them. The scenario matched 2 files, both of which happened to pass,
and reported green while checking almost nothing.

This is a spec-time defect, not a coding one: nothing in the ticket obliged
anyone to show the derived candidate set was non-trivial. It also **fails
open** — unlike BL-233 (missing handler throws) and BL-1006 (stale assertion
goes red), a blind matcher is silently green forever. It was caught only
because the architect hand-counted the population.

Amendment landed in `swarmforge/roles/specifier.prompt` (scope `role:specifier`,
Article 5.1), commit `dce5e90739`: a "derived, never a list" scenario carries a
second `Then` step pinning the census — the count the derivation must find, or a
named file that must appear in the candidate set, chosen for the idiom the
codebase actually uses — and the ticket records the exact grep the census was
counted with. Boot prefix budget gate ok at 43983/44000 (unchanged: a role
prompt is not in the shared prefix).

## Determinism candidates — offered, not ticketed this pass

`pass-bounce-evidence` (dominance 0.0093), `backlog-promotion` (0.189),
`backlog-closure` (0.473) — the same three offered on 09-06 and 09-07.
No open ticket declares `ritual_class:` for any of them
(`BL-1479` declared `backlog-promotion` and is closed, in `done/M8/`).

Not ticketed this pass, deliberately: each already has a shipped helper
(`swarmforge/scripts/close_ticket.sh`, `promote_and_route_next.sh`,
`route_backlog_to_coder.sh`), so the gap between them and a deterministic
ritual is adoption, not absence of tooling — and `promote_and_route_next.sh`'s
own fixtures have been red since 08-20 and are already owned by BL-1480
(promoted to active this shift). Minting a mechanisation ticket over a red
mechanism would be minting on a stale premise. Expect all three to be offered
again; per the ritual-ledger contract that repeat is the fail-toward-firing
posture, not a defect.

## Signals I looked at and did not act on

- **QA / hardener dwell.** Highest again, as on every recent shift. QA is the
  integration point (BL-247) and hand-lands; the land-step hazards it is
  working around are already owned (BL-1472/1473/1474). No new hypothesis.
- **Four chases, four different tickets, count 1 each.** The mono-router
  rotation shape — a parcel arrives for a role that is not the resident and
  waits for the rotation. Not a repeated chase on a stuck parcel; nothing to
  ticket.
- **`qualityRecommendations`.** Advisory dial changes, disposition
  `recommended`; the coordinator's half of the ceremony owns those.
