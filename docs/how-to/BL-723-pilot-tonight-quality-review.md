# BL-723 — Pilot-tonight quality review

Queue-jump review, 2026-07-30: the live swarm walks the 13 defect tickets an
offline pilot closed tonight and says whether those landings meet the normal
live-swarm quality bar. This is a first draft, landed by the coder hop of the
parcel per BL-723's own ordering note — the coder viewpoint and all 13
per-ticket verdicts below are real findings from reading each ticket's actual
landing commit and tests, not placeholders. The remaining five seats'
viewpoint sections are explicit placeholders for the cleaner, architect,
hardener, documenter, and QA hops still ahead of this parcel; the acceptance
gate (`specs/features/BL-723-*.feature`) is expected to stay red until the
documenter finishes this body and commits the briefing email, per BL-723's
own text.

**Overall verdict:** NOT ON PAR

**Verdict reasons:**
Coder-level review of all 13 landings found 5 not-on-par: two (BL-718,
BL-559) share the same systemic gap — a hand-authored Gherkin acceptance
feature with zero step handlers wired, so `specs/pipeline/cli.js` would
throw "no step handler matched" rather than actually gating; one (BL-637)
has a live, reproducible false-positive regression in the exact
multi-worktree condition its own ticket was about; one (BL-636) has a
landing commit whose message claims a fix its own diff never made; one
(BL-642) left the precise leak class its ticket was meant to close open for
any multi-word role name. None of these are the kind of gap a normal live
coder-through-QA pipeline pass — where BL-112 requires the coder to run the
acceptance entry point, and QA independently re-runs it before merge — would
let through undetected. The other 8 tickets (BL-627, BL-641, BL-646, BL-623,
BL-671, BL-694, BL-661, BL-662) are on-par, several with only minor,
non-blocking nits noted in their own sections below. This is a coder-only
verdict pending the cleaner, architect, hardener, documenter, and QA hops
still ahead of this parcel; it may be revised as those seats add their own
findings.

**Process:** BL-723 walked the live swarm path after queue-jump: this parcel
moved specifier -> coder (this hop) and continues through cleaner ->
architect -> hardener -> documenter -> QA like any other ticket, per
`required_stages`. It was not driven by the offline expeditor or the offline
pilot — no `expedite.sh` invocation and no offline pilot session produced
this document.

## Viewpoints

### Coder viewpoint

Reviewed all 13 landing commits and their tests directly (`git show` on each
ticket's actual implementation commit, not just its QA-land/status-flip
commit — BL-559's is a special case, see its own section). Read for:
whether the diff matches what the commit message and ticket both claim,
whether tests assert real behavior rather than prompt text or tautologies,
and whether the acceptance feature file (if any) actually has a wired step
handler so it can gate rather than throw. Findings are recorded per-ticket
below and, for the 5 not-on-par tickets, as a paired remaining-work +
pilot-process defect (BL-726/727, BL-728/729, BL-730/731, BL-732/733,
BL-734/735). Two patterns recur across tonight's batch worth flagging up
front rather than only per-ticket: (1) a hand-authored feature file with no
step handler is not a one-off — it happened on both BL-718 and BL-559,
suggesting the pilot's own acceptance-wiring step (BL-112) was skipped or
not verified as a class, not just missed once; (2) BL-559 in particular did
no coder work under this ticket at all — it rode a week-old, unrelated
commit and was QA-landed twice (once reverted). Full reasoning lives in each
ticket's own section and in its `notes:` field in `backlog/done/`.

### Cleaner viewpoint

PENDING — this parcel has not yet reached the cleaner hop. The cleaner will
review the 13 landings' readability, DRYness, and naming, and fill in this
section with real findings when this parcel arrives, per BL-723's ordering
note (coder lands a first draft; downstream seats complete their own
viewpoints as the parcel travels the pipeline).

### Architect viewpoint

PENDING — this parcel has not yet reached the architect hop. The architect
will review the 13 landings' architecture, design patterns, and the
declared-invariant property-test contract, and fill in this section with
real findings when this parcel arrives.

### Hardender viewpoint

PENDING — this parcel has not yet reached the hardener hop. The hardener
will review the 13 landings' test coverage, mutation survival, and CRAP, and
fill in this section with real findings when this parcel arrives.

### Documenter viewpoint

PENDING — this parcel has not yet reached the documenter hop. The
documenter owns finishing this review body (per-seat content from every
hop) and committing the briefing email body under `docs/briefings/`, and
will fill in this section with real findings when this parcel arrives.

### QA viewpoint

PENDING — this parcel has not yet reached the QA hop. Per BL-723's own
text, the QA viewpoint section must be the fullest of all six once this
document is finished — QA compiles and re-verifies every other seat's
findings against the live pipeline bar before landing this ticket, and will
fill in this section, substantially longer than the placeholders above, when
this parcel arrives.

## Per-ticket verdicts

### BL-718

**Verdict:** not-on-par

The Bubble talk mirror chunking implementation itself
(`mirrorLetsTalkTurnToBubble`, the shared chunker reuse, the Bubble-vs-Cursor
topic suppression) is correct and has real behavioral unit tests in
`extension/test/letsTalkBridge.test.js` covering chunk reassembly and the
operator-event failure path. But its acceptance feature file
(`specs/features/BL-718-*.feature`) has zero step handlers anywhere under
`specs/pipeline/steps/` — running it would throw "no step handler matched"
on every scenario, so the acceptance contract this ticket names has never
actually gated.

**Filed defects:** BL-726 (remaining work), BL-727 (pilot process)

### BL-627

**Verdict:** on-par

Root cause addressed directly: wrong per-model rates corrected, the missing
`claude-opus-5` roster entry added, and a fail-loud `checkPricingCoverage`/
`assertPricingCoverage` invariant added so an unpriced model in the actual
roster throws rather than costing as zero. Deliberately declines to build
the cron the operator explicitly rejected. Tests are fixture-backed and
real; the wired acceptance suite passes end to end. Minor nit only, not
filed as a defect: the conf/JSON model scanner is a regex heuristic rather
than a real parser, so an unusually-shaped model id could still evade
detection.

**Filed defects:** none

### BL-636

**Verdict:** not-on-par

The priority-first rotation-ordering fix itself
(`mono_router_lib.bb`'s `preferred-rotate-target`) is correct and covered by
real unit assertions for the exact starvation scenario the ticket describes.
But the landing commit's message claims it also restores a `deliver!`
close-paren dropped by BL-611 in `handoffd.bb` — the actual diff never
touches that file; that fix exists only on an unmerged sibling commit. The
paren is closed on `main` today only incidentally, via a later, unrelated
BL-611 commit.

**Filed defects:** BL-728 (remaining work), BL-729 (pilot process)

### BL-637

**Verdict:** not-on-par

Script renaming (`kill_pipeline_swarm.sh` extracted from `kill_all_swarm.sh`),
`--help` scope wording, and the new full-stack `stack_survivor_scan.sh` are
all correct and root-scoped. But `kill_pipeline_swarm.sh`'s own post-kill
survivor check kept the old unscoped `pgrep` pattern — not anchored to
`$ROOT` the way the reaping loop two lines above it is. Reproduced live: it
false-positives on a legitimately running `handoffd.bb` from a sibling
worktree, which is the exact multi-worktree condition this repo runs in
daily and is what this ticket exists to handle correctly. This failed the
ticket's own acceptance suite (8/8) and one shell test when re-run during
this review.

**Filed defects:** BL-730 (remaining work, severity high, live reproducible false positive), BL-731 (pilot process)

### BL-641

**Verdict:** on-par

Matches the ticket's shape exactly: 20-minute headroom (not a job-level
cap) on the Pages deploy step, and a repo-wide major-version bump across all
workflow files that actually pin the affected actions. Acceptance suite ran
7/7 against real parsed YAML. No coder-eye concerns found.

**Filed defects:** none

### BL-642

**Verdict:** not-on-par

`FOOTER_START_PATTERN` and the `NO_QUESTION_TEXT_CAPTURED` fail-closed
fallback are correct and well tested against the ticket's real repro pane
text. But `PANE_TITLE_SESSION_NAME_PATTERN` only matches a single-token role
name after "SwarmForge " — `swarmforge.sh`'s `display_name_for_role()`
title-cases multi-word roles (e.g. `model-steward` -> "Model Steward"), and a
title-rule line for such a role is not recognized as chrome, confirmed
directly against the shipped regex. This leaves open the exact leak class
the ticket was meant to close, for any multi-word role.

**Filed defects:** BL-732 (remaining work), BL-733 (pilot process)

### BL-646

**Verdict:** on-par

Addresses the actual root cause (CWD-relative fixture writes rather than a
worktree-root-anchored temp dir), correctly inverts the babysitter hint only
for the pure-fixture case (never telling a role to `git add` test debris),
and the guard-root assertion is a genuine regression test. Ran both suites
live: 23/23 shell checks and 12/12 acceptance scenarios pass; the 8
previously-stray files no longer exist. No coder-eye concerns found.

**Filed defects:** none

### BL-623

**Verdict:** on-par

Logic is correct for all documented routing-skip scenarios; the acceptance
suite genuinely shells out to `bb swarm_handoff.bb` against a scratch git
fixture and asserts on real header/journal output. Minor nits only, not
filed as separate defects: an unreachable fallback branch in the `emit-skip`
caller, and `log-routing-skip!` has no try/catch despite the ticket's own
"a record-write failure must not block the send" guardrail — no scenario
exercises that path either.

**Filed defects:** none

### BL-671

**Verdict:** on-par

Root cause (ten hand-maintained, unsynced `cp` lists) addressed structurally
via one shared sandbox-copy helper. Cross-checked the helper's lib list
against `operator_runtime.bb`'s actual `load-file` forms directly — all
present, none missing. The acceptance suite genuinely spawns bash against
all 10 real fixture scripts end to end, and the events-lock fixture flake
fix is a bonus correctness improvement. No coder-eye concerns found.

**Filed defects:** none

### BL-694

**Verdict:** on-par

Design directly satisfies the stated invariant (backlog-ticket exemptions
survive a stage move via basename matching; everything else stays
exact-path). Acceptance suite exercises the real `scanUnexpected`/
`isAllowlisted` functions across all 5 scenarios, and later commits reusing
the same pattern show it is a real, adopted abstraction rather than a
one-off patch. Minor dead-code nit only (an unexercised step registration
with no matching Examples row) — not filed as a separate defect.

**Filed defects:** none

### BL-559

**Verdict:** not-on-par

The property suite it names does pass (7/7, real assertions on the rendered
anchor label), but the fix it verifies predates this ticket's own filing and
landing entirely — no coder work happened under this ticket. It was also
QA-landed twice (paused -> done, reverted, re-landed), and its acceptance
feature file has zero step handlers anywhere under `specs/pipeline/steps/`,
so the acceptance contract was never mechanically gated, only asserted in
commit-message prose.

**Filed defects:** BL-734 (remaining work), BL-735 (pilot process)

### BL-661

**Verdict:** on-par

Root cause (block-style-only scanner vs. universally flow-style
declarations) correctly fixed at the source; the unit suite ran live, all
pass, covering the real parsing hazard (quoted reasons containing commas and
braces). Caveat, not filed as a separate defect: scenario 05 (the routing
skip-trail audit record carries a flow-style reason end to end) has no step
handler wired against `swarm_handoff.bb` itself — the `.bb` unit test only
simulates the embed, so that specific consumer-impact claim is unverified
end-to-end.

**Filed defects:** none

### BL-662

**Verdict:** on-par

Root cause fixed directly (the parsed response body was being discarded) via
a shared `reasonOrFallback` helper that also removes prior duplication
between the two response branches; jsdom tests genuinely drive the compiled
script and exercise both action types. Caveat, not filed as a separate
defect: the ticket asked to sweep the rest of the file for the same shape —
a scan turned up nothing else, but the sweep isn't documented in the commit;
and the feature file's Scenario Outline has no matching
`specs/pipeline/steps/` handler (covered instead by hand-written unit tests,
which are genuinely real).

**Filed defects:** none
