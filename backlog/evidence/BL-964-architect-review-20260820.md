# BL-964 — architect review pass 1: complete inventory, PASS

- **Ticket**: BL-964 — regression gate against the retired `SWARMFORGE_ENSURE_*` env-var prefix (`type: chore`, M8)
- **Commit reviewed**: `8bfecb4ae0` (cleaner batch)
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## Invariants review

`invariants: []` — no declared invariants, so the BL-633/BL-654 property-test
obligation is a **no-op** for this ticket. Stated rather than skipped silently.

## What the gate must get right, and does

The failure class is **soft**: a fake exported under the retired spelling is
ignored by `swarm_ensure.bb`, the REAL extension bounce runs, and the test still
passes — two VS Code Extension Development Host windows opened unprompted from
test runs on 2026-08-20. Only a standing gate can stop it recurring.

| Check | Result |
|---|---|
| Gate on the current tree (`qa_e2e` step 1) | **4/4 pass** — `retiredEnsureEnvVarGuard.test.js` |
| **Non-vacuity, proven by me** | I planted the exact historical bug shape (`SWARMFORGE_ENSURE_EXTENSION_CHECK=…` + `SWARMFORGE_ENSURE_SUPERVISOR=…` in a `bb "$ENSURE"` invocation) into `swarmforge/scripts/test/`. The gate **failed**, naming the file; removing it returned the suite to 4/4. |
| **False positive the ticket warns about** | Correctly avoided. The needles are the FULL retired names, so the two legitimate bare-prefix comment mentions that live *inside* guarded dirs — `bl571SequentialRotationDormantParitySteps.js:123` and `test_swarm_ensure.sh:570`, both writing `SWARMFORGE_ENSURE_*` — are not flagged. The suite pins this with its own dedicated case. |
| Self-exemption handled without a carve-out | The helper spelling the literals lives at `extension/test/helpers/`, **outside** both guarded dirs, so it needs no exclusion rule. The BL-964 step handlers, which do live in a guarded dir, build the names from split parts at runtime — `grep -c` for the literal in them returns **0**. A roster-style exemption would have been the fragile alternative; this is structural. |
| Acceptance 01–04 | **4/4 pass** (three Examples rows for the flagging case, one for the clean tree) |
| Dependency-rule gate (BL-259, hard gate) | **RUN, exit 0, clean** |
| Operator directive honoured verbatim | Yes — *"regression grep in a test gate (`SWARMFORGE_ENSURE_EXTENSION` must not appear in `specs/pipeline/steps/` or `swarmforge/scripts/test/`)"*. Both named directories are guarded. |
| No side effect from my own review runs | Confirmed — no `Extension Development Host` process exists after the full run, which is the incident's own symptom. |

## Observation, not a defect

The gate scans exactly the two directories the operator directive names. I checked
whether any test path OUTSIDE them exports ensure fakes and could reintroduce the
class unseen: the only hits outside are the gate's own helper/test (deliberately
placed there so it may spell the literals) and `swarmforge/scripts/swarm_ensure.bb`,
which is the CONSUMER, not an exporter. So the present risk surface is fully
covered, and widening the scan today would guard nothing. Recorded only so a future
reader knows the two-directory scope was checked for completeness rather than
copied from the directive unexamined — if ensure fakes ever start being exported
from `extension/test/`, the scan would need to widen with them.
