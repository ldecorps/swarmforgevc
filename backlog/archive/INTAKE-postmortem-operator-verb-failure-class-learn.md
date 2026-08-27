# INTAKE — `/postmortem` operator verb: qualify outage, teach babysitterd, teach operator repair

**Source:** human (Laurent), 2026-08-27 ~06:44 BST  
**Status:** new intake, not minted  
**Priority:** high — closes the **Learn** loop left open by detect/diagnose/repair work;
today's STARVED incident is the motivating instance.

## Goal

Add a shared operator action verb **`/postmortem`** that, after an outage clears
(or on explicit operator/human request), does three things in one bounded pass:

1. **Qualify the cause** — name a stable `failure_class`, ordered hypotheses,
   and evidence (not a verdict handed down from chat).
2. **Teach babysitterd to recognize it** — persist correlation hints so the
   next occurrence rolls up to one disaster-class finding instead of N undifferentiated
   CRIT lines.
3. **Teach the operator how to fix it** — persist a minimal repair playbook
   (`suggested_actions` with owner: `babysitterd` | `operator` | `human`) wired
   into escalations and the operator prompt.

This intake is the **verb + durable learn artefacts** slice. The broader
Detect→Diagnose→Repair→Learn frame lives in
`INTAKE-disaster-recovery-detect-diagnose-repair-learn.md`; the half-launch/starvation
repair slice is `INTAKE-babysitter-half-launch-starvation-auto-recover.md`.
Mint one epic or parent here and link those as siblings — do not merge.

## Problem today

Post-incident learning is manual and leaky:

| Gap | Example (2026-08-27 morning) |
|-----|-------------------------------|
| No verb to **close the loop** | Human/Cursor wrote `INTAKE-*.md` by hand hours after recovery |
| Babysitter **does not remember** classes | Same `proc-*` + `handoffd` + `swarm-starved` stack reads as separate fires every sweep |
| Operator gets **symptoms**, not **playbook** | 145+ `BABYSITTER_ESCALATION` events with no `failure_class` or `suggested_actions` |
| Existing postmortem tooling is **forensic only** | `collect_daemon_postmortem.sh` bundles logs; it does not classify, teach checks, or update repair policy |

## Proposed verb

### Surface

| Field | Value |
|-------|-------|
| Verb | `/postmortem` |
| Args | optional `[failure_class]` or `[incident-id]` — default: most recent cleared disaster-class incident for this root |
| Tier | **soft** (light confirm) — writes artefacts and may update babysitter hints; not destructive |
| Ingress | Cursor Remote, Control topic, CLI wrapper — same shared backend as BL-698 verbs |

Aliases during transition: none required; do not overload `/doctor` (liveness snapshot)
or `/mint` (specifier intake drain).

### Behaviour (one bounded pass)

When invoked (manually or auto-enqueued after disaster-class **clear** — see triggers below):

1. **Gather evidence** from durable runtime state (no new daemon):
   - babysitterd sweep log tail + last disaster-class escalation JSON (if any)
   - `control_plane_lib.bb` incident record (BL-958) when present
   - `collect_daemon_postmortem.sh` bundle path (or last N lines of handoffd/babysitter logs)
   - operator queue timeline: first CRIT → repair attempts → cleared
2. **Qualify** — emit a structured record:
   - `failure_class` — stable token (e.g. `starvation-cascade`, `half-launch-mass`, `handoffd-parse-dead`)
   - `likely_causes` — ordered hypotheses from observables
   - `evidence_paths` — pointers under `.swarmforge/`
   - `repair_outcomes` — what auto-repair tried and whether it helped
3. **Teach babysitterd** — append/update a gitignored registry
   (`.swarmforge/babysitter/failure-classes.json` or specifier-chosen shape):
   - check keys that correlate (e.g. `handoffd` + ≥3 `proc-*` + `swarm-starved`)
   - rollup token → one disaster-class finding
   - optional threshold overrides (streak before escalate) — **hints only**; checks stay deterministic
4. **Teach operator** — append/update operator playbook
   (`.swarmforge/operator/failure-class-playbooks.json` or equivalent):
   - `suggested_actions` per class with owner
   - short Telegram-friendly summary for the next escalation of this class
5. **Mint learn artefact** — write
   `backlog/INTAKE-disaster-<class>-<YYYYMMDDTHHMMSSZ>.md` stub (or append rolling
   disaster journal if review prefers one file) containing timeline, qualified cause,
   open questions for specifier. **Do not** auto-mint BL tickets (BL-311 authority).

Reply to operator names: `failure_class`, playbook updated (y/n), intake path written.

### Triggers (specifier picks default)

| Trigger | When |
|---------|------|
| Manual | operator/human runs `/postmortem` after recovery |
| Auto (optional) | babysitterd sees disaster-class CRIT → clear within window; enqueue one soft event "postmortem ready — Confirm to run" |
| Refuse | no incident record and no recent CRIT within lookback → refuse with "nothing to postmortem" |

Auto-trigger must be **idempotent** — one postmortem pass per `(failure_class, incident window)`.

## Wiring into existing loops

Reuse; do not re-invent:

- **BL-958** `control_plane_lib.bb` — incident record is the spine for qualify step
- **BL-653** — escalations gain `failure_class` + `suggested_actions` from playbook when class matches
- **BL-848** hotfix ledger — declared hotfixes stay separate; `/postmortem` covers **undeclared** disasters
- **`collect_daemon_postmortem.sh`** — evidence bundle input only
- **BL-698** operator verb backend — register `/postmortem` in shared parse + exec façade

Babysitterd correlation reads the failure-class registry at sweep start (cheap JSON read);
operator prompt reads playbooks when rendering `BABYSITTER_ESCALATION` detail.

## Acceptance direction (for specifier)

- Scenario: inject starvation-cascade (≥3 half-launch + handoffd down + starved) → clear
  via ensure → `/postmortem` writes qualified record, updates babysitter registry and operator
  playbook, mints `backlog/INTAKE-disaster-*` stub.
- Scenario: second occurrence same class → babysitter emits **one** disaster-class escalation
  naming playbook actions; not 9× separate CRIT symptom lines.
- Scenario: `/postmortem` with no recent incident → refuse cleanly.
- Scenario: unrecoverable class (parse error) → postmortem qualifies cause, playbook says
  "human hotfix required", babysitter registry still updated so recurrence is recognized.

## Out of scope

- Fully automated LLM root-cause analysis without human confirm on the learn artefacts
- Auto-promoting intakes to active tickets without specifier
- Replacing `collect_daemon_postmortem.sh` — it remains the log bundle primitive
- Re-litigating repair policy in `INTAKE-babysitter-half-launch-starvation-auto-recover.md`

## Related

- `INTAKE-disaster-recovery-detect-diagnose-repair-learn.md` — parent frame (Detect→Learn)
- `INTAKE-babysitter-half-launch-starvation-auto-recover.md` — today's repair slice
- `backlog/evidence/incident-20260713-quiet-swarm-postmortem.md` — manual postmortem shape to emulate
- Hotfix `a8741f5ac` — handoffd parse + standing launch-contract (landed 2026-08-27)
