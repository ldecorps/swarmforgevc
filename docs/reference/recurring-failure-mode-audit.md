# Recurring failure-mode audit (BL-512)

**Date:** 2026-07-19  
**Scope:** Evidence-backed inventory of modes agents keep re-hitting, with classification and a ranked proposed-fix slate.  
**This ticket does not implement the fixes** — it separates already-fixed noise from open defects and operational gaps.

**Headline:** The biggest live problem is not “agents make bugs.” It is that the swarm **does not auto-heal** when a role is productively stuck (claim-without-progress, wrong worktree branch, launch-config drift). Durable telemetry already shows the classic infra failures were fixed; today’s pain is **self-recovery**.

---

## Method

### Structured scan (reproducible)

Pure module: `extension/src/metrics/failureModeInventory.ts`  
CLI: `extension/out/tools/failure-mode-inventory.js` (paths injected; no network / no clock).

Inputs used for this audit run (2026-07-19):

| Source | Path / extract | Notes |
|---|---|---|
| Rule proposals | `.swarmforge/rule_proposals/*.jsonl` → `/tmp/bl512-evidence/rule_proposals.jsonl` (19 lines) | Signature = normalized `body` |
| QA bounces | `.swarmforge/qa_bounces/*.jsonl` → `…/qa_bounces.jsonl` (43 lines) | Signature = `failureClass:producingRole` |
| Commit subjects | `git log` over `backlog/evidence/` + bounce/revert greps → `…/commit_subjects.txt` | Normalized subject |
| Chaser | tail of `.swarmforge/telemetry/chaser-2026-07.jsonl` (20k lines) | `chase`/`nudge`/`respawn`; minCount≥3 |

Raw ranked JSON: `/tmp/bl512-evidence/inventory.json` (344 grouped signatures).

### Judgment layer

Classification below is human/architect judgment over that scan plus durable evidence under `backlog/evidence/` and `backlog/done/`. Chaser `chase:*` floods (thousands) are treated as **health-loop noise**, not failure modes, unless paired with high `respawn` / `nudge` or an incident write-up.

---

## Inventory summary (meaningful modes)

| Count | Signature | Primary citations |
|------:|---|---|
| 31 | `qa_bounce:behavior:coder` | `qa_bounces` L10–L12… (e.g. BL-381@90fbcd7a, BL-382@55b9c3ba, BL-386@d16078e7); tickets include BL-331…BL-519 |
| 3 | `qa_bounce:acceptance:coder` | `qa_bounces` BL-441@7905e291, BL-451@ba4a7f90, BL-505@06399b25 |
| 2 | `qa_bounce:integration:coder` | qa_bounces jsonl |
| 2 | `qa_bounce:unit:coder` | qa_bounces jsonl |
| 7 | `chaser:nudge:specifier` | chaser@2026-07-18… |
| 5 | `chaser:nudge:cleaner` | chaser jsonl |
| 3 | `chaser:nudge:coder` | chaser@2026-07-19T00:17Z / 10:57Z / 11:03Z |
| 19 | distinct `rule_proposal:*` (count=1 each) | rule_proposals L1–L19 — patterns, not yet recurrence-counted |
| — | Live ops (2026-07-19 session) | BL-512 claim-loop on coder; wrong branch `BL-526`; `ROTATION_MODE` unset; coordinator `aider` without `--model` |

Chaser `chase:specifier|QA|cleaner` (7k–4k) and `respawn:*` (100–200) are **operational load**, not root causes by themselves — see operational section.

---

## Classified modes

### already-fixed

Modes that used to recur and are **resolved** on `main`. Disposition = the ticket/commit that closed them. Do **not** re-file.

| Mode | Evidence | Resolved by |
|---|---|---|
| Corrupt / undeliverable handoff drafts | Feature preamble; `backlog/done/BL-365-corrupt-handoff-never-dispatched.yaml` | **BL-365** |
| tmux socket under `/tmp` (control permanently lost) | `backlog/evidence/BL-367-BL-368-tmux-socket-in-tmp-20260714.md` | **BL-367** (`backlog/done/BL-367-swarm-socket-not-in-tmp.yaml`) |
| Control-loss misread as agent death / clobber recreate | `backlog/evidence/BL-368-control-loss-is-not-agent-death-bounce-20260714.md`, `BL-368-already-shipped-20260716.md` | **BL-368** |
| Launcher phantom-reverts / clobbers tracked worktree files | Feature preamble; rule_proposals L13 (“4th phantom-revert… BL-365”); `backlog/done/BL-373-…` | **BL-373** |
| Orphaned agent processes after control loss | done ticket | **BL-486** |
| Stale acceptance sandboxes left in `/tmp` | evidence commit subjects (`BL-413`); done ticket | **BL-413** |
| Chase-sweep re-chases resolved / duplicate | done ticket | **BL-499** |
| Quiet-swarm false death stack (stale build, unpushed, wedged interactive op, …) | `backlog/evidence/incident-20260713-quiet-swarm-postmortem.md` | Family **BL-328 / BL-294 / BL-333…** (postmortem: mostly fixed or ticketed) |
| Pure `:no-task-spin` endless loop burning tokens | loop detector in `handoffd.bb` + Telegram/email halt | Commits `65cdc143`, `e7149af9` (halt + alert) |

classification: `already-fixed` — disposition is the resolving ticket/commit above.

---

### open-code

Genuinely open defects or missing automation. Each gets a **root cause** and one **proposed fix ticket**. Ranked below by frequency × impact (auto-heal gaps weighted highest because they burn tokens and stall the whole pack).

#### Rank 1 — Claim-without-progress / TASK reclaim loop

- **Signature / evidence:** Live BL-512 session (coder repeatedly `ready_for_next` → same TASK → idle at `>`); related historical green-but-halted swarm in `backlog/evidence/BL-109-BL-121-BL-122-handoff-halt-20260706.md`. Chaser `nudge:coder` ×3 on 2026-07-19.
- **Root cause:** Inbox/claim layer treats “task assigned” as healthy. Loop detector covers **NO_TASK spin**, not **TASK claimed but no commits / no tool use / same reclaim**.
- **Why auto-heal matters:** Human should not babysit; handoffd should bounce the claim, re-route, or escalate after N idle reclaim cycles.
- **proposed fix ticket:** `BL-528` — Auto-heal claim-without-progress (detect idle reclaim of same task; nudge → reassign → halt+alert).

#### Rank 2 — Worktree / branch ≠ claimed ticket

- **Signature / evidence:** Live: coder worktree still on **`BL-526`** while claim is **BL-512**; bounce hygiene in `backlog/evidence/BL-490-expedite-approval-button-bounce-20260717.md` (fix commit not on the line QA tests); rule_proposals L11–L12 (sibling bounce / ancestor checks).
- **Root cause:** Resume-on-start and bounce merges do not assert `worktree branch/ticket == active claim` before the agent spends a turn.
- **proposed fix ticket:** `BL-529` — Pre-turn ticket/branch guard; auto-checkout or refuse-and-requeue on mismatch.

#### Rank 3 — Launch-config drift (coordinator model, rotation mode)

- **Signature / evidence:** Live mono-router: coordinator bare `aider --yes-always` (no `--model`); `ROTATION_MODE: parameter not set` on role launch from dirty/unstaged `swarmforge.sh`; historical `backlog/evidence` for BL-314 coordinator-model bounce.
- **Root cause:** Provision paths partially wire models; pack/env defaults are not self-validated at ensure-time. Weak models + missing rotation → busy-idle thrash that looks “healthy.”
- **proposed fix ticket:** `BL-530` — Ensure-time self-heal: refuse start / auto-rewrite launch argv when `COORDINATOR_MODEL` / `ROTATION_MODE` / pack contract missing.

#### Rank 4 — Coder behavior-bounce storm (incomplete delivery / false-green)

- **Signature / evidence:** `qa_bounce:behavior:coder` **count=31** (largest non-chaser mode); e.g. BL-419 evidence (`backlog/evidence/BL-419-shared-checkout-commit-integrity-bounce-20260717.md` — wiring never landed); BL-490 durability bounce.
- **Root cause:** Heterogeneous product bugs, but a shared meta-cause: parcels reach QA without durable commit ancestry / wiring checks the specs themselves asked for.
- **proposed fix ticket:** `BL-531` — Pre-QA durability gate (ancestor of ticket commits + required wiring greps from the feature) before handoff to QA.

#### Rank 5 — Inherited / sibling bounce contamination

- **Signature / evidence:** Multiple bounce write-ups citing “blocked by BL-469 icon collision in shared batch tree”; rule_proposals L11.
- **Root cause:** Shared worktrees / batched merges re-bounce healthy parcels for a sibling’s defect.
- **proposed fix ticket:** `BL-532` — Isolate bounce recovery trees; skip re-queue when failure signature matches a sibling’s open bounce.

#### Rank 6 — Spec/feature delivered uncommitted; dark modules

- **Signature / evidence:** rule_proposals L8, L9; BL-256 bounce subject (feature claimed coverage never built).
- **Root cause:** “Spec ready” / “module done” reported before git track + runtime wire.
- **proposed fix ticket:** `BL-533` — Specifier/coder exit gates: `git status` clean for claimed paths; runtime-wiring checklist for multi-slice epics.

#### Rank 7 — CLI / CRAP-invisible main() pattern

- **Signature / evidence:** rule_proposals L5, L6 (recurring hardener proposal).
- **Root cause:** Logic left in `main()` only hit via subprocess → 0% CRAP visibility → regressions slip.
- **proposed fix ticket:** `BL-534` — Lint/gate: tools under `extension/src/tools/` must export pure helpers; `main()` thin-wrapper only.

classification: `open-code` — disposition is root cause + proposed fix ticket (`BL-FIX-*`) above.

---

### operational

Not primarily a code bug; needs a **guardrail** or **operator procedure**.

| Mode | Evidence | Guardrail / procedure |
|---|---|---|
| Standing-role nudge storms when pipeline empty | `chaser:nudge:*` counts; mono-router idle rules | Pack procedure: after NO_TASK, STOP; coordinator only nudged on open slot (document + enforce in pack prompt). Treat repeated nudges without promotion as ops alert, not more chase. |
| High chase/respawn on specifier/QA/cleaner | chaser chase ×7k / respawn ×100–200 | Operational SLO: alert when respawn/hour exceeds threshold; prefer heal over respawn. |
| Rule proposals accumulate without closure | 19 unique proposals, count=1 each | Procedure: weekly rule-proposal triage (accept → constitution/role file, or reject with reason). Governance ticket already paused (BL-035 family) — reopen or supersede. |
| Inventory commit-subject noise (`architect review: pass`) | commit signature count 8 | Procedure: evidence commits use stable bounce prefixes; ignore “review: pass” in future scans. |
| Human expects auto-heal; today many recovers are manual | BL-109 forensics; 2026-07-19 live | Operator procedure until BL-528–003 land: on green-but-stuck, check claim vs branch vs last commit age before relaunch. |

classification: `operational` — disposition is guardrail or operator-procedure change.

---

## Ranked proposed-fix slate (open-code only)

Priority = occurrence frequency × blast radius (token burn / whole-swarm stall weighted up). **Auto-heal first**, per operator intent.

| Rank | proposed fix ticket | Mode | Freq signal | Impact |
|-----:|---|---|---|---|
| 1 | **BL-528** | Claim-without-progress auto-heal | Live + nudge:coder×3; related BL-109 | High — burns tokens, blocks pipeline |
| 2 | **BL-529** | Ticket/branch mismatch guard | Live BL-512/BL-526; BL-490 lineage | High — silent wrong work |
| 3 | **BL-530** | Launch-config self-heal (model/rotation) | Live ROTATION_MODE / aider --model | High — pack-wide misbehavior |
| 4 | **BL-531** | Pre-QA durability / wiring gate | qa_bounce:behavior:coder ×31 | High — bounce volume |
| 5 | **BL-532** | Sibling-bounce isolation | Multi evidence “blocked by BL-469…” | Medium — false rework |
| 6 | **BL-533** | Spec commit + runtime-wiring exit gates | rule_proposals L8–L9 | Medium |
| 7 | **BL-534** | Thin-main / CRAP-visible CLI gate | rule_proposals L5–L6 | Medium — quality gate |

Filed 2026-07-19 into `backlog/paused/` as BL-528..BL-534 (was audit placeholders BL-FIX-001..007). Specifier still writes APS features.

---

## Auto-heal gap (operator ask)

Today the swarm can:

- detect pure **NO_TASK** busy-loops and **halt + Telegram/email**;
- reap orphans, protect sockets, avoid phantom worktree clobber (**already-fixed**).

It still **cannot** auto-heal:

1. claimed task with no progress,
2. wrong branch for the claim,
3. missing launch contract (`--model`, `ROTATION_MODE`).

Those three are why a “healthy” dashboard can still sit useless until a human intervenes. **BL-528–003** are the audit’s primary recommendation.

---

## Reproduce this inventory

```bash
# from repo root (paths injected — do not rely on defaults)
mkdir -p /tmp/bl512-evidence
cat .swarmforge/rule_proposals/*.jsonl > /tmp/bl512-evidence/rule_proposals.jsonl
cat .swarmforge/qa_bounces/*.jsonl > /tmp/bl512-evidence/qa_bounces.jsonl
tail -n 20000 .swarmforge/telemetry/chaser-2026-07.jsonl > /tmp/bl512-evidence/chaser.jsonl
# commit subjects: see audit method
node extension/out/tools/failure-mode-inventory.js \
  --rule-proposals /tmp/bl512-evidence/rule_proposals.jsonl \
  --qa-bounces /tmp/bl512-evidence/qa_bounces.jsonl \
  --commit-subjects /tmp/bl512-evidence/commit_subjects.txt \
  --chaser /tmp/bl512-evidence/chaser.jsonl \
  --chaser-min-count 3 \
  --json
```

Unit tests: `cd extension && npx vitest run test/failureModeInventory.test.js`
