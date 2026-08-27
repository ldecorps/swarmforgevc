# BL-780 — architect bounce — 20260827

**Reviewed tip:** tip-pure cherry-pick `08d028e3d` + `6afcdc682` → architect `ae5b287dc`
(inbound coder rematch `1181f60e0f` evidence-only)
**Handoff:** `50_20260827T061823Z_001208_from_coder_to_architect`

## Verdict

**Bounce → coder.** Review inventory below. Tip purity of the rematch line is OK;
gates that run (unit / ordering script / APS 5/5) are green — not the bounce cause.

## Tip purity

`08d028e3d`..`6afcdc682` functional paths are BL-780-only (conf default, mono_router
ordering guard, handoffd startup warn, unit + ordering script, APS steps). Good.

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

**Invariant:** "Every rotation-actionability threshold shipped or configured for
notes sits strictly below flow_watchdog_warn_ms for the same effective config —
an inverted pair is reported at daemon start, never silently accepted."

**Repro:** Parcel exposes pure `rotation-actionability-ordering-warnings` but only
example asserts in `mono_router_lib_test_runner.bb` + three fixed shell cases.
No `*_property_runner.bb` / generative encoding over (note, starve, warn) triples.
No stated non-encodability reason on the ticket or in coder evidence.

**Remediation:** Encode the ordering relation as a property (e.g. babashka
property runner): sound triples → empty warnings; any note-or-starve ≥ warn →
non-empty warning naming both values. Show the property goes red against a
deliberately silenced warning path, then restore.

### D2 — `invariant-unencoded` (blame: coder)

**Invariant:** "BL-576 broadcast-thrash protection is unchanged at whatever
note_actionable_after_ms value ships: a five-role merge-up still drains at most
one role per sweep with ROTATE_HOME between drains."

**Repro:** APS scenario covers one fixture path; no property (or stated
non-encodability reason) quantifies "at most one drain per sweep" across aged
broadcast shapes.

**Remediation:** Property over multi-role aged-note mailboxes asserting ≤1
rotate target per sweep / ROTATE_HOME between drains, **or** a written
non-encodability reason on the ticket/evidence if the rotate surface is not
pure-testable.

## Architecture / other checks

- Default 600000 vs warn 900000 ordering by construction: OK.
- Startup report-only (no silent rewrite): OK on read of handoffd wiring.
- Dep-gate N/A (bb/conf; no new TS src cycle).
- Stage skips (cleaner/hardender/documenter) respected; next hop after pass would be QA.

By architect.
