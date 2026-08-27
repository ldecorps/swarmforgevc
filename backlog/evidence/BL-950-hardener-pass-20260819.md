# BL-950 hardener pass — 2026-08-19

## Reviewed commit
`00ed04c838` ("BL-950: architect pass - QA approval hop gate verified,
invariants property-tested with proven reachability, forwarding to
hardener"), merged into hardener as this parcel. No bounce.

## Why this pass got extra scrutiny
This gate sits live in every agent's `swarm_handoff.bb` send path,
including my own — `review-roles` already includes `hardender`, so every
`git_handoff` I've sent this session has been running through this same
predicate under BL-806. BL-950 adds ONE new disjunct (`qa-approval-hop?`)
without touching anything the four existing review roles depend on. A
mistake here does not route around — it either strands a legitimate send
across the whole swarm or (worse) silently fails to close the exact
evidence hole that let BL-585 close untraced. Read the core logic in full
myself rather than only re-running the suites.

## Scope, precisely
`git show --stat 19bec94d8f` — BL-950's own 5 files: the acceptance step
handler, `index.js`'s registry line, the gate lib itself, and its two bb
test/property runners.

## Tooling scope check
No `extension/src/*.ts` or `extension/test/` file touched. Stryker/CRAP/
DRY inapplicable. The gate lib is Babashka — no mutation/CRAP/DRY tool
wired at this boundary; gated by its own unit + property runners plus
the acceptance feature.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load / BL-149 cooldown gate**: 18–23 on 4 cores. All 5 changed
   files skip-busy/skip-cooldown; no formal mutation tooling applies
   regardless (Babashka boundary).
2. **Independent re-run of both bb suites**:
   - `bb swarmforge/scripts/test/review_forward_evidence_gate_lib_test_runner.bb`
     — ALL PASS (existing BL-806 rows + 7 new BL-950 rows).
   - `bb swarmforge/scripts/test/review_forward_evidence_gate_lib_property_runner.bb`
     — ALL PASS (broad-generator oracle + the by-construction
     reachability-proven pass for the QA hop specifically).
3. **Acceptance, independently re-run**: this ticket's own feature —
   **6/6 PASS**.
4. **Full independent read of the core predicate logic** (own hardening
   judgment, not just re-running suites — warranted given this gate's
   blast radius):
   - `qa-approval-hop?` is exactly `sender = "QA" AND recipient =
     "coordinator"`, nothing wider — confirmed by reading the function
     body directly, not the docstring.
   - `blocked?`'s direction conjunct is `(review-roles sender AND
     routes-forward?) OR qa-approval-hop?` — purely additive; the four
     existing review roles' gating is completely untouched by this OR
     branch (they still resolve through the first disjunct exactly as
     before BL-950).
   - Traced why a QA merge-up NOTE (the broadcast I've personally
     received and merged many times this session, e.g. "BL-XXX
     QA-approved ... merge your branch up") can never be blocked by this
     new disjunct: `blocked?` also requires `type = "git_handoff"`, and
     a merge-up broadcast is `type: note` — the type conjunct alone
     excludes it, independent of the direction predicate.
   - Traced why a multi-recipient QA broadcast (also something I've
     received, e.g. "to: coder,cleaner,architect,hardender,documenter")
     can never be blocked: `blocked?` requires `(= 1 (count
     recipients))` — a multi-recipient send fails this conjunct
     regardless of direction.
   - Traced why a QA bounce (recipient = coder, not coordinator) can
     never match `qa-approval-hop?`'s recipient check.
   - Confirmed `qa-approval-hop?` does NOT touch
     `required_stages_lib/canonical-order` — grepped
     `review_forward_evidence_gate_lib.bb` for `canonical-order`: zero
     hits in this file's own diff, matching the ticket's own explicit
     warning that widening `canonical-order` would leak into
     `route-required-stages`'s other callers. The new predicate is
     fully self-contained.
5. **Wiring confirmed live, not just unit-tested in isolation** (no
   `required_wiring:` is declared on this ticket, deliberately, per its
   own notes — checked myself anyway given the stakes): grepped
   `swarmforge/scripts/swarm_handoff.bb` for
   `review-forward-evidence-gate-lib/blocked?` — present and called from
   the real send path (line ~306), the exact mechanism every
   `swarm_handoff.sh` invocation in this swarm goes through, mine
   included.
6. **Leak/process check**: 0 leaked `bl950`-prefixed fixture dirs;
   `git status --short` clean; no stray tmux servers.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling. Both bb suites
and the acceptance feature reconfirmed green under my own hand. Given
this gate's live position in every agent's own send path, went beyond
suite re-runs to independently trace all four of invariant 1's exclusion
shapes (bounce, note, multi-recipient, reroute) through the actual
predicate logic myself, and confirmed the new disjunct is genuinely
additive and genuinely wired into the live send path, not merely tested
in isolation.

Forwarding to documenter.

By hardener.
