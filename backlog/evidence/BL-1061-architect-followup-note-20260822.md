# BL-1061 — architect pass, follow-up observation (not a bounce)

Reviewed merge `38befd58b` (coder `f378db6bc9`, cleaner pass-through
`e780671c30`). Architecturally clean, both declared invariants are backed by
real, non-vacuous property tests, and the required wiring
(`bl1061TunnelFixtureIsolationSteps` registered in
`specs/pipeline/steps/index.js`) is present. Verified independently, not just
trusted from the parcel's own claims:

- `dependency-gate.js` full-repo scan: 3 pre-existing `acyclic` violations in
  `telegramCursorOperatorExec.ts`/`telegramCursorOperatorLiveness.ts`/
  `telegram-front-desk-bot.ts` — none of this parcel's files, already ticketed
  as BL-759.
- `co-change-report.js` on the changed files: only the expected registry
  co-change (`specs/pipeline/steps/index.js` with every new step file) —
  nothing new.
- `npx vitest run --config vitest.properties.config.mjs` on all three touched
  property files: 11/11 passed, including invariant 1/3 on
  `bl857TunnelOwnershipInvariants.property.test.js` — run live on this host
  **while the operator's real `swarmforge-bubble` tunnel (pid 316866) was up**,
  matching the ticket's own qa_e2e_procedure step 2. Confirmed the real tunnel
  was still alive and no fixture process was left behind after the run.
- `bash swarmforge/scripts/test/test_bl1061_tunnel_reap_enumerates_full_command_lines.sh`:
  4/4 PASS, real tunnel unaffected.
- `stop_ancillary_services.sh` only calls the public `tunnel_reap_orphans`
  entry point, so it inherits the enumeration fix without needing its own
  change.
- Sibling suites `test_tunnel_ownership_lib.sh`,
  `test_stop_ancillary_services_tunnel_orphan_reap.sh`,
  `test_launch_resident_spy_named_tunnel.sh`,
  `test_launch_resident_spy_tunnel_operator_root_refusal.sh` currently cannot
  run on this host at all — they source `tmp_cleanup.sh`, which hits the
  already-ticketed BL-1058 GNU-`mktemp -t` defect at source time. Pre-existing,
  untouched by this parcel, not a regression it introduced.

## The observation

`backlog/evidence/BL-1061-coder-root-cause.md` §5 ("Out of scope, and
surfaced rather than swept") names two more production sites carrying the
exact same `pgrep -fl` truncation defect this ticket fixes in
`tunnel_ownership_lib.sh` — confirmed by reading both:

- `swarmforge/scripts/start_bridge_headless.sh:140` — the kill guard
  `[[ "$line" != *"$ROOT"* ]]` depends on `$line` carrying the command's path
  argument. Under `-l` on procps-ng, `$line` never carries it, so the
  condition is always true and the guard can signal a bridge belonging to a
  DIFFERENT root than the one it was scoped to.
- `swarmforge/scripts/kill_pipeline_swarm.sh:243` — `grep -v
  handoffd_supervisor` depends on the same truncated line never containing
  that string. Under `-l` it never does, so the filter excludes nothing and
  the supervisor process becomes reapable by its own kill sweep.

Both are the identical defect class BL-1061 fixes (BSD `pgrep -fl` semantics
assumed, silently wrong on procps-ng/Linux), in files this ticket's `acceptance`
and `invariants` do not name and that the coder correctly did not touch.

## Why this is a note, not a bounce

The coder implemented exactly what this ticket's invariants require, completely
and correctly, and explicitly recorded these two sites as out of scope rather
than silently leaving them or silently fixing them (the evidence file: "Neither
is BL-1061 and neither is touched here. Both are worth a ticket."). Bouncing
this parcel to expand it to two more production scripts would be authorizing
work outside this ticket — the same concern "An Approval Authorizes Only Its
Ticket's Work" exists to prevent.

Sent as a `note` (priority 50, non-blocking — this is a widening-scope
observation, not something blocking BL-1061 itself) to specifier and
coordinator, for the specifier to judge whether it warrants a follow-up
ticket.

By architect.
