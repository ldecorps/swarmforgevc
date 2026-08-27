# INTAKE — disaster recovery loop: babysitter recognizes, operator gets clues, post-mortem intakes mint after

**Source:** human (Laurent), email 2026-08-27 ~06:39 BST; Cursor generalization  
**Status:** new intake, not minted  
**Priority:** high — cross-cutting reliability; today's STARVED incident is one instance,
not the whole story.

## Goal (two steps, generalized)

1. **Make babysitterd recognize the issue and give the operator a clue as to what
   is going on** — not a wall of undifferentiated CRIT lines.
2. **Operator can fix** — with enough structured context to choose the minimal
   correct action (bounded auto-repair where safe; human/LLM judgement where not).

3. **After recovery, mint a post-mortem intake automatically** — so the swarm
   learns and tickets the recurrence class instead of relying on a human to
   remember to write `INTAKE-*.md` by hand.

This intake is the **general** frame. The narrower half-launch/starvation shape
from 2026-08-27 is one concrete instance (`INTAKE-babysitter-half-launch-starvation-auto-recover.md`);
do not merge them — mint an epic or parent ticket here and link the instance
as a child or related intake.

## Problem today

Babysitterd is good at **finding** things and **escalating** them:

- Per-check CRIT/WARN findings (`proc-*`, `handoffd`, `swarm-starved`, …)
- `BABYSITTER_ESCALATION` events appended to operator queue (BL-653)
- Coordinator nudges for some findings

It is weak at **synthesis** and **closure**:

| Gap | Example (2026-08-27 morning) |
|-----|------------------------------|
| No failure **class** rollup | 9× `proc-*` half-launch + `handoffd` + `swarm-starved` read as separate fires, not one "starvation cascade" |
| Operator gets **symptom**, not **likely cause + next step** | Escalation text names idle panes, not "handoffd parse error → ensure blocked → agents never respawned" |
| **Deterministic repair** stops at missing session / missing control plane | Half-launch (pane exists, agent gone) escalates only — no `:ensure-session` |
| **No post-incident artifact** | Human/Cursor wrote intake by hand hours later; nothing in-tree auto-minted `INTAKE-*` or post-mortem stub |
| Escalations **pile up** without consumption | 145+ pending operator events; `queue_consuming: false` — alerts ≠ recovery |

Existing partial building blocks (reuse, do not re-invent):

- **BL-958** `control_plane_lib.bb` — classification, incident record, `./swarm ensure` policy
- **BL-1017/BL-1018** — bounded per-role session repair (missing pane only)
- **BL-1071** — babysitter actually runs `./swarm ensure` on WSL
- **BL-653** — escalation wire to operator queue
- **BL-848** — hotfix certification ledger (learn path for declared hotfixes, not all incidents)
- **`collect_daemon_postmortem.sh`** — daemon log bundle (ops manual today)
- **`backlog/INTAKE-*.md`** — specifier drain convention

## Proposed loop (Detect → Diagnose → Repair → Learn)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│   DETECT    │────▶│   DIAGNOSE   │────▶│   REPAIR    │────▶│    LEARN    │
│ babysitterd │     │ failure class│     │ bounded auto│     │ INTAKE/post │
│ checks      │     │ + clue bundle│     │ or operator │     │ mortem mint │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
```

### 1. Detect (already mostly exists)

Keep per-check findings. Add optional **correlation** when multiple checks fire
together (e.g. `handoffd` down + all `proc-*` + `swarm-starved` → classify as
`disaster-class: swarm-starvation-cascade` or similar — name is implementer's call).

### 2. Diagnose (new — the "clue for operator")

When a disaster class is recognized (or a single CRIT persists N sweeps),
emit **one structured escalation** instead of N duplicate symptom lines:

- `failure_class` — stable token (e.g. `half-launch-mass`, `handoffd-dead`, `starvation-cascade`)
- `likely_causes` — ordered hypotheses from observable facts (parse error in handoffd.log,
  launch-contract FAILED in last ensure tail, etc.) — **hypotheses**, not verdicts
- `suggested_actions` — minimal next steps with **owner** (`babysitterd`, `operator`, `human`):
  e.g. "run `./swarm ensure`", "inspect handoffd.log last 20 lines", "respawn role X"
- `evidence_paths` — pointers under `.swarmforge/` (logs, audit files, ensure tail)

Wire into operator as a **single** `BABYSITTER_ESCALATION` (or new event type if
review prefers) with JSON detail the operator prompt can parse — avoid 145 copies
of the same class.

### 3. Repair (extend existing policy)

Policy matrix (direction, not mandate):

| Failure class | Bounded auto-repair | Operator / human |
|---------------|--------------------|--------------------|
| control-plane-missing | `./swarm ensure` (BL-958) | if ensure fails |
| pane missing | `:ensure-session` (BL-1017) | if no launch script |
| half-launch (pane up, agent gone) | `:ensure-session` respawn | if repair budget exhausted |
| handoffd dead (process absent) | `start_handoff_daemon.sh` when log shows clean start | if parse/startup error |
| swarm-starved (streak ≥ N) | `./swarm ensure` once | if still starved after ensure |
| unrecoverable (parse error, missing scripts) | **none** — diagnose only | operator/human hotfix |

Auto-repair must **never swallow the CRIT** — same invariant as BL-1017.

### 4. Learn (new — post-mortem / intake mint)

When a disaster class **clears** (health sweep green after prior CRIT, or human
marks recovery), automatically:

1. Write a stub `backlog/INTAKE-disaster-<class>-<YYYYMMDDTHHMMSSZ>.md` (or
   append to a rolling disaster journal if review prefers one file) containing:
   - timeline (first CRIT → repair attempts → cleared)
   - findings + repair outcomes from babysitterd logs
   - last N lines of relevant daemon logs (or pointer to postmortem bundle)
   - **open questions** for specifier (mint ticket? hotfix? process change?)
2. Optionally enqueue `CONFIG_CHANGED` or a dedicated operator event so
   specifier/coordinator sees "post-disaster intake ready to drain"
3. Do **not** auto-mint BL tickets — specifier retains intake→ticket authority (BL-311)

Hotfix path stays separate (BL-848 trailer + ledger); this learn step covers
**undeclared** disasters and recurrence prevention.

## Acceptance direction (for specifier)

- Scenario: inject half-launch on ≥3 roles + handoffd down → babysitter emits
  **one** disaster-class escalation with `suggested_actions`, attempts bounded
  repair where policy allows, and after clear writes an `INTAKE-disaster-*` stub
  under `backlog/`.
- Scenario: unrecoverable (e.g. handoffd parse error) → no repair storm;
  escalation names log path and "human hotfix required"; intake stub still minted on clear.
- Scenario: recovery within one sweep → intake stub optional/configurable (avoid noise).

## Out of scope

- Replacing operator LLM with fully automated fixes for all classes
- Auto-promoting intakes to active tickets without specifier
- Full `./start-swarm.sh` as default repair (BL-1017 posture)

## Related

- `INTAKE-babysitter-half-launch-starvation-auto-recover.md` — today's instance (repair slice)
- `INTAKE-handoffd-parse-error-bl668.md` (archived → BL-1163) — parse-error instance
- `INTAKE-babysitter-control-plane-auto-heal-hotfix.md` (archived → BL-1071) — ensure-on-WSL instance
- Hotfix `a8741f5ac` — handoffd parse + standing launch-contract (landed 2026-08-27)
