# Ticket request — ambulance workflow gaps (live run BL-688, 2026-07-27)

**From:** operator (human)  
**Severity:** high (mode engaged but patient stalled; non-patient mail partially leaked; resident wrong role)  
**Suggested type:** defect (against BL-655 shipped behaviour) + small feature slice for operator workflow  
**Suggested epic:** swarm-reliability  
**Depends on:** BL-655 (done), optionally BL-679 (paused — perimeter; some gaps below are NOT in 679)  
**Suggested id:** BL-691 (next free) or fold defect fixes into BL-679 if specifier prefers one parcel

## Operator intent (what we tried)

Engage ambulance for **BL-688** to freeze **BL-590** at QA and let only BL-688 move. Path A: promote BL-688, route build, release when QA lands.

## What actually happened

| # | Expected (BL-655) | Observed |
|---|-------------------|----------|
| 1 | Only BL-688 parcels move | BL-688 reached QA ✓ eventually, but only after manual promote + coordinator routing |
| 2 | Non-patient parcels held at delivery | BL-590 doc→QA handoff **landed in QA `inbox/new`** while ambulance engaged (sync deliver path) |
| 3 | Rotation prefers ambulance patient's mail (ambulance-hold-05) | Parcel `000440` sat in **QA `inbox/new` 1h+**; resident stayed at **coder home** redoing BL-688 |
| 4 | Engage → patient moves | BL-688 was still in **`paused/`** when engaged; nothing could move until operator Path A promote |
| 5 | Patient finishes → release | Not reached yet; BL-688 now with QA (operator confirms 13:28) |

## Defects (with evidence)

### D1 — Site 1 hole: sync deliver bypasses ambulance

BL-655 wired site 1 only in `handoffd.bb` `poll-once!`.  
`swarm_handoff.bb` → `handoff-inject-lib/deliver-parcel!` delivers outbox→inbox **without** calling `ambulance-lib/parcel-held?`.

**Evidence:** Ambulance engaged 10:54 UTC for BL-688. BL-590 handoff `000438` created 10:55, present in QA `inbox/new`. Zero `deliver-skip-ambulance` lines in `handoffd.log` for that parcel (never went through daemon delivery). Documenter `sent/` confirms sync `HANDOFF DELIVERED`.

**Fix:** Single predicate at `deliver-parcel!` (and any other sync inject path) — same as handoffd; held parcels stay in outbox.

**Acceptance:** Extend BL-655 feature or new scenario — sync deliver with ambulance engaged holds non-patient parcel in outbox.

### D2 — Site 3 incomplete: no rotate-to-holder for patient parcel

`ambulance-hold-05` asserts rotation prefers ambulance parcel over newer mail **elsewhere**, but live run: patient's only actionable `git_handoff` in **QA** inbox while resident idle/busy at **coder**. No rotation to QA for ~1h; handoffd logs `chase-wake-skip-busy QA` and `chase-wake-skip-busy coder`.

**Hypothesis:** Site 3 filters held mail from actionability but does not **pull** resident to the role mailbox that holds the patient's unclaimed parcel; mono-router `ROTATE_HOME` / idle boundary may win over QA-with-patient-mail.

**Fix:** When ambulance active and patient has dequeueable `git_handoff` in role R's `inbox/new`, `preferred-rotate-target` must rank R above home idle — even if home has stale active-ticket work.

**Acceptance:** Scenario: ambulance BL-688, parcel in QA `new/`, BL-590 also in QA `new/` (held), resident at coder → rotate to QA.

### D3 — Engage without patient in pipeline = silent deadlock

`ambulance_cli.bb engage` only requires YAML **anywhere** under `backlog/`. BL-688 was in `paused/`; engage succeeded; **nothing moved** (no active ticket, no dispatch). Operator had to file Path A intake.

**Fix (pick one or combine):**
- `engage` refuses unless patient is in `active/` OR auto-promotes patient to `active/` with coordinator `note` (priority 00)
- `engage` prints explicit warning: "patient not active — promote before expect movement"
- BL-679 perimeter promotion-freeze is separate; this is **pre-ride** patient readiness

### D4 — `assigned_to` stale (related; may be separate ticket)

After coder forwarded BL-688, yaml still `assigned_to: coder` while parcel at QA. Contributed to resident re-work (see `INTAKE-coder-rework-inflight-parcel-blind-spot.md`). Ambulance workflow should update holder on forward or at least on stage transition.

## Not in scope for this ticket

- Full BL-679 perimeter (watchdog quiet, auto-exit on done/) — still wanted, but distinct
- Expeditor / expedite lane changes

## Suggested acceptance themes

1. Sync + async delivery both respect `parcel-held?`
2. Ambulance patient parcel in non-home role inbox causes resident rotation to that role
3. Engage refuses or auto-promotes non-active patient
4. Connected test: engage BL-688, hold BL-590, promote patient, parcel reaches QA, QA rotated and claims — no coder duplicate pass

## Live artifacts

- `.swarmforge/operator/control-ambulance.json` — engaged BL-688
- QA handoffs: `000438` (BL-590, held), `000440` (BL-688, patient)
- `INTAKE-ambulance-path-A-promote-BL-688.md` — manual workaround
- `INTAKE-coder-rework-inflight-parcel-blind-spot.md` — downstream symptom

## Disposition

Specifier: draft `backlog/paused/BL-691-*.yaml` (+ `.feature`), **normal priority after BL-688 QA lands** — operator 2026-07-27: **do not expedite**. Coordinator: do not release ambulance until BL-688 merges unless operator directs.
