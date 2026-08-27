# BL-888 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `b91011afa5` (coder rematch + cleaner DRY on
`origin/main`=`fc32a06081` lineage).

## Scope

`origin/main...b91011afa5` = **7 paths**, BL-888-only. Hitchhike CLEAN.

## Architecture — PASS (with property-encoding gap under D1)

- Step 5 replaced unscoped `pkill -f 'copilot.*SwarmForge'` with
  `copilot_pids_for_root` / `copilot_argv_matches_root` / `reap_copilot_pid`
  (ROOT path + copilot + SwarmForge; `SWARMFORGE_COPILOT_PS_FILE` seam).
- required_wiring met; no extension/webview. Dep-gate N/A (shell parcel).

## Acceptance / units (advisory — do not hand-verify invariants without encoding)

- APS BL-888 → **3/3**
- `test_kill_pipeline_copilot_scope.sh` → ALL PASS

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

One declared invariant; tip has **no** `*.property.test.js` / property
runner encoding it, and **no** stated non-encodability reason.

> A teardown kill step signals only processes belonging to the root being
> torn down — a process of any other root, or of the operator's own tooling,
> is never signaled.

APS + fixed shell unit cases exercise shapes but are not the property-test
obligation (architect.prompt / BL-633 / coder.prompt BL-654).

Encode (non-vacuous; RED when deliberately broken — e.g. drop ROOT from the
match or restore unscoped pkill):

- Quantify over argv/root pairs: sibling/foreign ROOT never yields a pid;
  same-ROOT SwarmForge copilot argv does; missing SwarmForge marker does not.
- Prefer a shell or babashka property runner over the pure
  `copilot_argv_matches_root` surface (or extract a small pure matcher if
  that keeps generator reach honest), following other script-parcel runners
  under `swarmforge/scripts/test/`.

## Property-testing support (undeclared) — BLOCKED BY D1

Match helpers are property-shaped; declared encoding first.

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | invariant-unencoded | coder | bounce |

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.

By architect.
