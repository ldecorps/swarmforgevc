# BL-1445 architect bounce (2026-09-08)

## D1: scenario 02's source-detection regex is blind to the dominant sourcing idiom, including this ticket's own principal file

**Class:** behavior (correctness defect spotted during architecture review)
**Blamed role:** coder
**File:** `specs/pipeline/steps/bl1445StaffingGateWiringTestDecidesOverrideSteps.js`, the
`every shell test under swarmforge/scripts/test that sources swarmforge.sh is inspected`
step (uses `/source\s+['"]?\S*swarmforge\.sh/` against each file's raw content).

**What's wrong:** every real shell test in this codebase (including
`swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh` itself, this
ticket's own principal file) sources the launcher through a variable —
`SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"` followed by `source
'$SWARMFORGE_SH' ...` — never `source .../swarmforge.sh` as a literal
token. The regex requires the literal substring `swarmforge.sh` to appear
immediately after `source`, so it fails to match `source '$SWARMFORGE_SH'`.

Verified: of 23 shell tests under `swarmforge/scripts/test` that reference
`SWARMFORGE_SH` and use a `source` statement, only 2
(`test_openrouter_provider_support.sh`, `test_model_factory_runtime_wiring.sh`)
match the regex — the other 21, including `test_pack_staffing_gate_wiring.sh`
itself, are invisible to scenario 02's candidate scan:

```
node -e "console.log(/source\s+['\"]?\S*swarmforge\.sh/.test(require('fs').readFileSync('swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh','utf8')))"
# => false
```

**Failure scenario:** scenario 02's own comment and the ticket's
`invariants`/description call for a check "derived by grep, never a list"
that covers *every* test that sources the launcher and asserts on the
gate. Because the regex only matches the rare literal-path idiom, a new
test written tomorrow using the codebase's normal `SWARMFORGE_SH` variable
pattern that asserts on the gate's refusal/override text but forgets to
decide `PACK_STAFFING_SKIP_GATE` itself would pass scenario 02 silently —
reproducing the exact BL-1445 hazard (a refusal case silently becoming an
override warning under the pane's own export) with no structural check to
catch it. The scenario currently reports green only because the two files
it *does* see already happen to set the override on purpose; it is not
actually validating what it claims for the codebase's real sourcing
pattern.

**Remediation:** broaden the source-line detection to also recognize a
variable populated from a `swarmforge.sh` path (e.g. treat a file as a
launcher-sourcing test when it both contains a `source` statement and the
literal substring `swarmforge.sh` anywhere in the file — the variable's own
assignment line carries it — rather than requiring the literal path
directly after `source`), then re-verify that `test_pack_staffing_gate_wiring.sh`
and every other `SWARMFORGE_SH`-sourcing gate-asserting test is actually
picked up as a candidate.

No other findings from this pass (invariants 1 and 2 are correctly
encoded and non-vacuous; the wiring test itself passes clean under
`PACK_STAFFING_SKIP_GATE=1`, `=0`, and unset; dependency-gate and
co-change checks are clean).
