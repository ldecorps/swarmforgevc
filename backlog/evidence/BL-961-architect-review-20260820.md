# BL-961 — architect review pass 1: complete inventory, PASS

- **Ticket**: BL-961 — the launcher bakes `SWARMFORGE_PACK` into every generated role launch script (`type: defect`, `severity: medium`, M8)
- **Commit reviewed**: `dd00974f3b` (cleaner) — coder `1aaf72fcd7`
- **Reviewer**: architect, 2026-08-20
- **Verdict**: **PASS — inventory items: NONE.** Forward to hardender.

---

## The change

Three lines in `write_role_launch_script` (`swarmforge/scripts/swarmforge.sh:1518-1525`):
derive `launch_pack_name` from `CONFIG_FILE` via `basename … .conf`, and emit
`export SWARMFORGE_PACK='$launch_pack_name'` inside the generated script's main
heredoc, one line below the existing `SWARMFORGE_ROLE` export.

## Declared-invariant pass (BL-633/BL-654)

**Invariant 1** — *one launch exports an identical value in every role script, equal
to the basename of the conf actually loaded.*

Holds **by construction**, and I traced the derivation rather than trusting it:
`CONFIG_FILE` has exactly two assignment sites — the default
(`${SWARMFORGE_CONFIG:-…/swarmforge.conf}`, line 92) and `--pack NAME` →
`packs/NAME.conf` (line 103). Both are resolved *before* any launch script is
written, and `launch_pack_name` derives from that single variable, so the env var
and the `--pack` selector cannot name different packs. Critically, the inbound
`${SWARMFORGE_PACK:-}` is passed only to `check_launch_pack_guard` as a *guard
input* (line 112) — it is never a selector, so a stale inbound value cannot leak
into the export.

**Invariant 2** — *the export lives in the generated file itself, so a respawn
carries it.* Verified positionally: the line sits inside the
`cat > "$launch_script" <<LAUNCH` heredoc (1521–1535), not in a `tmux
set-environment` or a `-e` respawn flag. Acceptance scenario 04 and shell case 04
both assert it survives an **emptied environment**, which is the property that
matters.

| Check | Result |
|---|---|
| Property runner `bl961_pack_export_property_runner.bb` | **ALL PROPERTIES HOLD** — 30 runs over the REAL launcher generation; coverage `{:pack-conf 23, :default-conf 7, :multi-role 19}` (all three shapes reached, incl. multi-role for invariant 1's "every script identical"). |
| `test_swarmforge_pack_export.sh` | **ALL PASS**, exit 0 — incl. case 04 (emptied environment still yields the pack). |
| Acceptance 01–04 | **4/4 pass**, incl. the outline rows and "every role's generated launch script carries the same export". |
| `required_wiring` literal | **SATISFIED and correctly placed** — `export SWARMFORGE_PACK` is at line 1525, inside `write_role_launch_script` (starts 1328), i.e. in the generated-script template. Not the BL-419 shape (a helper that computes a value but never writes the line). |
| Independent generation probe | I generated a launch script directly through the real `swarmforge.sh` in a fresh fixture and read the artifact: `export SWARMFORGE_PACK='swarmforge'` present on line 4. |
| Dependency-rule gate (BL-259, hard gate) | RUN — only the pre-existing `out/tools/telegram*` `acyclic` cycle; parcel touches no telegram file. |
| Co-change (BL-255) | RUN, informational — nothing flagged that this parcel should have touched. |
| Shell portability | `swarmforge.sh` is **zsh** (`#!/usr/bin/env zsh`), so the stock-bash-3.2 `${arr[@]}` rule does not apply here. `local` declared separately from its assignment, so `set -e` still sees the `basename` exit code — correct, and matching the file's own idiom. |
| Quoting | `'$launch_pack_name'` inside an expanding heredoc mirrors the adjacent `SWARMFORGE_ROLE='$role'` exactly; pack names are conf basenames, so no quoting hazard in practice. |
| Architecture | Launcher-only change; no new module, no boundary crossed, single source of truth for the pack name. |

## An observation I raised and then WITHDREW

While running the new shell test I saw
`write_role_launch_script:212: command not found: terminal_backend_can_open_sessions`
and suspected BL-961's test of exercising a truncated generation path. Both halves
turned out to be wrong, and I checked rather than reporting it:

- The call sits in an `if` **condition** at line 1540, *after* the main heredoc
  closes at 1535 — so `set -e` does not fire, generation completes, and only an
  optional cleanup-owner append is skipped. The export at 1525 is unaffected.
- The message is **not** BL-961's doing: my own independent fixture, driving the
  real `write_role_launch_script` with no BL-961 test code involved, emits the
  identical line. It is inherent to the established source-and-call harness
  pattern that six pre-existing tests also use.

Recorded so a later reader does not re-open it as a BL-961 defect.

## Routed separately by `note` — a PRE-EXISTING red acceptance feature

`swarmforge/scripts/test/test_resume_on_start.sh` exits **1 silently** (no output
at all), and because `specs/pipeline/steps/resumeOrphanedInProcessSteps.js` runs
it via `spawnSync`, **BL-323's acceptance feature is red: 3 of 5 scenarios fail**.

**Attribution, verified by targeted removal rather than assumed:**

| Experiment | Result |
|---|---|
| Current tree | exit 1 |
| BL-961's `export SWARMFORGE_PACK` line removed | exit 1 — **not BL-961** |
| BL-967's `daemon_cycle_guard_lib.bb` load-file removed from `handoff_lib.bb` | exit 1 — **not BL-967** |

Both restored. So the redness is independent of this parcel and of the BL-967
parcel I passed earlier today; it is almost certainly pre-existing on `main`.
I did **not** confirm it on a clean `main` checkout, and the silent
no-output shape leaves an environment-specific cause open — the note says so
rather than overclaiming. Routing to specifier + coordinator per Article 4.4;
this is not a second bounce and BL-961 is not held for it.
