# BL-1416 — hardener pass, 2026-09-05

Ticket: BL-1416-busy-pane-never-auth-dead
Commit reviewed: 456d089a59 (cleaner) / 45c4fe6eb4 (architect, NONE pass)

## Result: NONE — no defect found; one BL-113 gherkin-mutation finding, equivalent

## Re-verification (all re-run independently in this worktree, all green)

| check | result |
|---|---|
| `bb swarmforge/scripts/test/provider_auth_observe_lib_test_runner.bb` | PASS (all assertions) |
| `bb swarmforge/scripts/test/bl1416_busy_pane_never_auth_dead_property_runner.bb` | ALL PROPERTIES HOLD, 500/500 each of P1/P2/P3, coverage `{:p1-min-attempts-nonzero 401, :p2-some-skipped 425, :p2-all-performed 75, :p3-nil-line 116}` |
| `bb swarmforge/scripts/test/provider_auth_observe_lib_property_runner.bb` (BL-536 regression) | ALL PROPERTIES HOLD, 500/500, unaffected |
| `bash swarmforge/scripts/test/test_handoffd_auth_observe_wiring.sh` (real daemon + fake tmux, regression) | PASS 01-03, unaffected |
| `node specs/pipeline/cli.js specs/features/BL-1416-...feature` | 7/7 scenario runs pass |
| `grep -n 'actively-processing? pane) :healthy' swarmforge/scripts/handoffd.bb` | matches (required_wiring #1) |
| `bl1416BusyPaneNeverAuthDeadSteps.js::registerSteps` present | yes (required_wiring #2) |

No orphaned tmux/handoffd/node processes and no leaked fixture roots after
any of the above (checked via `pgrep` and a fresh-mtime `/tmp` scan before
and after).

## BL-113 soft gherkin mutation (Scenario Outline present — this ticket's
   feature qualifies, unlike BL-1407's plain-scenario feature)

Ran `specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1416-a-busy-pane-is-never-auth-dead.feature <fresh mktemp
under ./tmp> specs/pipeline/steps/index.js soft` (all 4 positionals
explicit, fresh workdir removed after). Result: 3 mutants (the Outline's 3
`<text>` example rows, each single-letter-case-flipped), **all 3 survived**.

### All 3 survived mutants are equivalent (BL-234) — recorded, not chased

`decide-auth-observation` (`provider_auth_observe_lib.bb:87-96`):

```clojure
(if (:busy? cfg)
  {:signal :healthy :state (or prev-state {:attempts 0 :alerted false}) :action :none}
  (let [signal (classify-auth-signal pane-text)] ...))
```

When `:busy?` is true (which is exactly scenario 01's condition — "the pane
shows the runtime's busy footer"), `pane-text` is **never passed to
`classify-auth-signal`/the regex at all**. The classification is `:healthy`
unconditionally, regardless of what the `<text>` example contains — that is
the scenario's own point ("no matter what its scrollback contains"). A
single-letter case flip inside a string that is never inspected cannot be
observed by any assertion the scenario could write; this is demonstrable
directly from the one-line short-circuit, not an assumption.

Belt-and-suspenders: even if the busy branch did not short-circuit, the
regex itself is case-insensitive (`provider_compat_lib.bb:145`,
`(?i)(invalid api...)`), so a case-only mutation would not even change
match status downstream. Either fact alone would make these equivalent;
both hold together.

This is not the BL-908 "picks its downstream test by shape" trap: the
handler does pass the literal `<text>` value through to the pane
construction (verified: `bl1416BusyPaneNeverAuthDeadSteps.js:55` captures
`text` from the step regex and builds the pane with it, unmodified) — the
value is read, just never consulted by the code path this scenario
exercises. Grepped for any OTHER site reading a busy-pane's text: none —
`observe-pane-auth!`'s busy branch is the only consumer of `:busy? true`
pane text, and it is exactly this short-circuit.

Per BL-502, the manifest correctly writes `scenarios: []` for this
feature (the Outline scenario had survivors so it is excluded; the manifest
absence does not mean the tool did not run — the run's own stdout
`total=3 killed=0 survived=3 errors=0` is the authoritative signal, and it
did run). Manifest stamp committed alongside this evidence.

## Design/CRAP/DRY

No production code changed by this pass. Babashka has no mutation/CRAP/DRY
tooling wired (BL-472 deferred, cleaner already recorded this fallback);
this pass adds nothing beyond what the cleaner and architect already
verified — gated by the unit/property/acceptance suites above plus the
BL-113 gherkin-mutation pass this ticket's Outline made possible.

## Verdict

No defect. Forwarding unchanged (plus the committed mutation-manifest
stamp) to documenter.
