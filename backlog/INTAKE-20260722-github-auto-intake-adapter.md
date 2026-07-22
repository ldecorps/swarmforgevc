# Human directive — GitHub auto-intake adapter + root-intake pickup

**From:** human (via Cursor operator session)  
**Date:** 2026-07-22  
**Authority:** operator ruling on intake architecture (follow-up to GH-22/GH-23 manual label + parallel workflow race)

## Problem

GitHub issues only enter the swarm when a human applies the `swarm-intake` label.
That triggers `.github/workflows/swarm-intake.yml`, which writes `backlog/GH-<n>-<slug>.yaml`
on `main`. The **specifier** drains backlog root; the **coordinator** promotes from
`paused/` — it must **not** poll GitHub or write specs.

Gaps observed today:

1. **Manual label step** — new issues sit in GitHub until someone remembers to label.
2. **Parallel intake race** — labeling two issues at once caused one workflow push to fail
   (GH-23); manual recovery was needed.
3. **Slow local pickup** — after `GH-*.yaml` lands on `main`, the swarm may not notice
   until specifier is rotated or someone pulls. `second-swarm-wakeup.yml` watches only
   `backlog/active/**` and `backlog/paused/**`, not backlog root.
4. **Board blind spot** — `readRootIntakeFiles()` lists only `backlog/*.md`, so `GH-*.yaml`
   intakes do not appear in the pipeline board ROOT INTAKE section.

## Architecture (do not violate)

| Layer | Owner | Duty |
|-------|-------|------|
| Infrastructure | GitHub Actions | Issue → `backlog/GH-*.yaml` on `main` |
| Infrastructure | `handoffd.bb` daemon | Detect undrained root files; nudge roles (never drain/promote) |
| Application | Specifier | Drain root → `backlog/paused/` + Gherkin; `issue_specced.sh` |
| Application | Coordinator | Promote `paused→active`, route; notice root intake (mono-router) |
| Infrastructure | QA | Merge, `issue_done.sh` close loop (BL-114) |

**Explicit non-goals:** coordinator LLM polling GitHub; coordinator writing specs;
daemon auto-promoting or auto-draining.

## Proposed epic: BL-558

Specifier: drain this intake into **one epic** `BL-558` in `backlog/paused/` plus a live
feature file from `specs/features/BL-558-github-auto-intake-adapter.feature.draft`.
Slice into implementable tickets only if depth/coupling demands it; default is one epic
with ordered slices below.

### Slice 1 — Scheduled GitHub auto-intake (primary)

New workflow (sibling to `swarm-intake.yml`, e.g. `swarm-intake-scan.yml`):

- **Trigger:** `schedule` (e.g. every 15 minutes) + optional `workflow_dispatch`.
- **Scan:** open issues that (a) do not already have `swarm-intake` or `swarm-specced`
  labels and (b) do not already have a matching `backlog/GH-<n>-*.yaml` on `main`.
- **Write:** same YAML shape as today's label-triggered workflow (`id`, `title`, `source`,
  `description`).
- **Acknowledge:** comment on issue + add `swarm-intake` label (keeps BL-114 loop intact).
- **Idempotent:** safe to re-run; never duplicate `GH-<n>` files.
- **Race-safe push:** before `git push`, `git pull --rebase origin main` (or retry loop)
  so parallel intakes cannot fail like GH-23.

Keep the existing **label-triggered** `swarm-intake.yml` as the fast/manual path.

### Slice 2 — `handoffd` root-intake nudge sweep

Mirror `open-slot-nudge-sweep!` in `chase_sweep_lib.bb` + `handoffd.bb`:

- **Detect:** `backlog/*.yaml` / `backlog/*.yml` at repo root (not under
  `active/`/`paused/`/`done/`), excluding `README.md`-class docs.
- **Decide:** pure `decide-root-intake-nudge?` with cooldown + pending-note dedup
  (same pattern as open-slot).
- **Act:** drop a fixed-phrase `note` on the **coordinator** asking it to ensure the
  resident rotates to specifier and drains root (mono-router pack already defines this;
  non-mono-router: nudge specifier directly — spec must cover both).
- **Never:** drain, spec, or promote from the daemon.

### Slice 3 — Second-swarm wake on backlog root (BL-092 extension)

Extend `.github/workflows/second-swarm-wakeup.yml` `paths:` to include backlog-root
intake patterns, e.g. `backlog/GH-*.yaml` and `backlog/INTAKE-*.md`, and teach
`remote_wakeup_lib.bb` (or the workflow diff step) that root GH items are primary-swarm
work (no `swarm:` field → primary).

### Slice 4 — Pipeline board ROOT INTAKE lists YAML (BL-465 gap)

Extend `readRootIntakeFiles()` to include `backlog/GH-*.yaml` and `backlog/BL-*.yaml`
at root (title from YAML `title:` field). Keeps `INTAKE-*.md` behavior unchanged.

## Dependencies / ordering

- Slice 1 is independent (GitHub-only).
- Slice 2–4 improve pickup after Slice 1 (or manual label intake) lands files on `main`.
- BL-114 close loop unchanged — specifier still runs `issue_specced.sh` after drain.
- Harden existing `swarm-intake.yml` push step (rebase-before-push) can ship inside Slice 1
  or as a tiny prep commit.

## Success criteria

- A new GitHub issue becomes `backlog/GH-<n>-*.yaml` on `main` without manual labeling
  (within one scan interval).
- Parallel intakes both land on `main` without workflow failure.
- Undrained `GH-*.yaml` at backlog root triggers a daemon nudge within one sweep cycle.
- Pipeline board ROOT INTAKE section shows GH YAML intakes.

## Spec location

Draft Gherkin: `specs/features/BL-558-github-auto-intake-adapter.feature.draft`
