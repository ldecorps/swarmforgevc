# BL-781 — architect bounce — 20260827

**Reviewed tip:** tip-pure `5ab769107` + rematch `85c2de2816` → architect `87b1ac953`
**Handoff:** `50_20260827T085037Z_001221_from_coder_to_architect`

## Verdict

**Bounce → coder.** Tip purity OK; deletions + salvaged libs OK; unit/property green.
Acceptance **10/13** — scenario 07 outline still red (3 examples).

## Inventory

### D1 — `acceptance` / live-grep filter incomplete (blame: coder)

**Repro:**
```
specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-781-retire-dead-babysitter-files-keep-list-preserved.feature
```
→ scenario 07 fails for each deleted basename with:
`live references to <file> outside history/docs: extension/test/bl781LiveGrepOffender.property.test.js`

**Cause:** Rematch D1 (QA) correctly excluded `specs/features/`, but the same rematch
added `extension/test/bl781LiveGrepOffender.property.test.js` which embeds the
retired basenames in `DELETED_WAKE`. `isLiveGrepOffender` does not treat
`extension/test/` as non-live, so the property file is reported as a live caller.

**Remediation (pick one, keep vacuity bite):**
1. Extend the non-live filter to dedicated BL-781 test paths under `extension/test/`
   that only name the basenames to assert absence (narrow — do not blanket-exempt
   all of `extension/`), **or**
2. Rewrite the property fixtures so grep does not see contiguous basename strings
   (construct paths without embedding `babysitter_lib.bb` etc. as literals), **or**
3. Move those string tables into an already-excluded tree (`specs/pipeline/steps/lib/`)
   if that stays architecturally clean.

Re-run APS to **13/13** before re-handoff.

## Other checks (not bounce items)

| Check | Result |
|-------|--------|
| Tip purity | BL-781 paths only (+ evidence) |
| Dead wake files absent | OK |
| Salvaged assess_lib / nudge_* present | OK |
| `bl781LiveGrepOffender.test.js` | 3/3 |
| `bl781LiveGrepOffender.property.test.js` | 5/5 |
| APS (before rematch of D1) | 10/13 — D1 above |

By architect.
