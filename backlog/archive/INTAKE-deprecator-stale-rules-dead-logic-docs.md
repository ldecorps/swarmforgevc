# INTAKE — Deprecator activity: Boy Scout for business rules, stale tickets, dead logic, and docs

**Source:** human (Laurent), 2026-08-27 ~07:03 BST; Cursor generalization from open question  
**Status:** ARCHIVED — minted as **BL-1172** epic + **BL-1173** (Q-jumped to active) + **BL-1174** (paused). Human Q-jump 2026-08-27 ~07:16 BST.

Was: new intake, not minted  
**Priority:** high — implementing old paused tickets without a freshness gate re-introduces
dead logic; docs scatter "RETIRED/superseded" inline with no systematic registry.

## Goal

Add a standing **deprecator** duty (not necessarily a ninth pipeline agent) that
keeps swarm **business rules** consistent with reality:

1. **Detect stale premises** — tickets, conf flags, operator verbs, babysitter
   checks, feature scenarios, and docs that assume a system shape that no longer
   holds.
2. **Remove dead logic** — not only unreachable code, but branches, gates, and
   rules that were superseded and should not be re-shipped when an old ticket
   lands.
3. **Retire docs honestly** — when logic goes, move affected pages to a
   **`docs/deprecated/`** section (indexed from `docs/index.md`); never leave
   living reference pages describing retired behaviour.

Shape: **Boy Scout for rules** — on-demand scan ranks stale items by recurrence
/ blast radius, one bounded retirement per run (or explicit refuse with reason),
human confirm on anything that deletes behaviour.

## Problem today

Several mechanisms touch pieces of this; none owns the whole job:

| Mechanism | Covers | Misses |
|-----------|--------|--------|
| Specifier INVEST + consolidation | Mint-time sizing; retire superseded paused tickets **at epic promotion** | No gate when a **3-month-old paused ticket** is promoted and implemented |
| BL-564 spec-drift (paused) | Code vs spec vs docs after OOB commits | Not "this business rule is obsolete"; epic is paused |
| BL-820 lean pass | Forge **process** debt at shift close | Explicitly not domain/product logic under build |
| Boy Scout (BL-1013) | Code/ops debt: CRAP, duplication, bounce recurrence | Not business rules or dead logic |
| Documenter | Docs for **this parcel's** shipped behaviour | No proactive hunt for obsolete rules across the tree |
| BL-1084 supersede guard | Stops pipeline on `.swarmforge/superseded/<task>` | Does not **find** stale work |
| `docs/archive/` | Superseded material | Two files; no deprecation registry or index discipline |

**Failure mode:** a ticket written months ago is implemented faithfully and
**re-introduces logic** that a later hotfix or epic already retired — because
nothing asked "does this still make sense?" before coder started.

## Proposed deprecator activity

### Posture

- **Duty, not a new standing pipeline seat by default** — same pattern as
  lean-coordinator (extend specifier + coordinator + documenter prompts with a
  named deprecator pass). Mint a child role only if review proves a separate
  seat is required.
- **On-demand trigger** — operator verb `/deprecate` (soft confirm) or Boy Scout
  epic slice 3; optional babysitterd WARN surfacing top-ranked stale item.
- **One retirement per run** — mirror BL-1015's "clean one thing or say why not"
  envelope; oversized retirements become ranked signals ("needs a real ticket").

### Scan sources (rank by recurrence + blast radius)

| Source | Signal |
|--------|--------|
| **Stale paused tickets** | `backlog/paused/` tickets whose `depends_on` are all `done/` but `assigned_to`/description reference removed modules, retired verbs, or superseded epics |
| **Supersession without retirement** | Tickets/epics marked superseded in notes but still in `paused/` or `active/`; `.swarmforge/superseded/` markers with no matching backlog retirement |
| **Spec-without-caller** | BL-564 slice 7 direction: feature scenarios referencing symbols/paths with no live caller (extend drift matrix) |
| **Conf/rule orphans** | `swarmforge.conf` / `cursor-forge.conf` keys with no reader in tree (grep-backed, best-effort) |
| **Inline RETIRED without doc move** | Code comments / Specification.MD entries saying RETIRED/superseded but linked how-to still in `docs/how-to/` or `docs/reference/` |
| **Bounce recurrence on spec-gap** | `.swarmforge/bounces/` where `failureClass: spec-gap` repeats on same ticket — ticket premise may be stale |
| **Postmortem learn registry** | When `/postmortem` (or disaster learn loop) records a `failure_class`, flag tickets whose acceptance still encodes the pre-fix world |

Rank key (direction): `(sourceCount, evidenceCount, blastRadiusEstimate, subject)` —
same recurrence philosophy as Boy Scout scan (BL-1014).

### Three-bucket adjudication (reuse BL-564)

For each candidate the deprecator pass adjudicates:

- **(a) rule/ticket stale → retire** — move ticket to `done/` with
  `closed_as: superseded-by-<id>` or archive; **retire** feature scenarios
  (never reword); remove dead logic in code; documenter moves docs to
  `docs/deprecated/`.
- **(b) rule still valid, implementation drifted → defect** — file ticket;
  do not "fix" spec to match a regression.
- **(c) ambiguous → human ask** — Approvals / operator event with evidence;
  never silently delete behaviour.

### Freshness gate (critical slice)

Before any **paused → active** promotion (coordinator or specifier):

1. Run deprecator **freshness check** on that ticket alone (cheap, not full scan).
2. Refuse promotion when: all `depends_on` done but description references
   retired surface; supersession marker exists; or scan flags HIGH stale score.
3. Outcomes: promote as-is | amend spec first | retire ticket | split ticket.

Wire into promotion path — not advisory-only.

### Documentation contract

- New **`docs/deprecated/`** mode directory (Divio-aligned: information-oriented,
  explicitly not current).
- Each retirement writes one stub page: what was removed, why, superseded-by
  pointer, date.
- `docs/index.md` gains a **Deprecated** section linking every page; living
  reference/how-to must not describe retired behaviour.
- `docs/archive/` stays for historical snapshots; `docs/deprecated/` is for
  **intentionally retired but still greppable** contracts.

### Operator surface

| Verb | Tier | Behaviour |
|------|------|-----------|
| `/deprecate` | soft | Full ranked scan; retire top item or refuse with reason |
| `/deprecate dry` | read | Scan only, no mutations |
| `/deprecate check BL-xxx` | read | Freshness check for one ticket (promotion gate) |

Shared BL-698 backend; CLI twin for terminal use.

## Wiring into existing loops

Reuse; do not re-invent:

- **BL-1013/BL-1014/BL-1015** — Boy Scout epic; deprecator is slice 3 or sibling epic
- **BL-564** — three-bucket adjudication + drift_matrix.bb; extend, do not duplicate
- **BL-820/BL-819** — lean pass may surface "ticket implemented against obsolete
  premises" as ceremony hypothesis → specifier mints deprecator slice
- **BL-1084** — supersede markers + pipeline refuse; deprecator **writes** markers
  when retiring in-flight-class work
- **Specifier consolidation** — epic-top-priority pass already retires superseded;
  deprecator makes that continuous, not only at epic promotion
- **`/postmortem` learn loop** — failure-class registry feeds stale-ticket signals

## Acceptance direction (for specifier)

- Scenario: paused ticket references retired module → `/deprecate check BL-xxx`
  refuses promotion with evidence; specifier amends or retires before active.
- Scenario: dead conf flag with no readers → `/deprecate` retires flag + docs
  stub under `docs/deprecated/`; living reference no longer mentions it.
- Scenario: feature scenario for retired behaviour → retired (not reworded);
  gherkin_lint_gate passes with scenario marked retired/skipped per existing rule.
- Scenario: ambiguous candidate → human ask; no silent deletion.
- Scenario: `/deprecate dry` → ranked list, zero mutations.

## Out of scope

- Big-bang delete of all stale paused tickets without human confirm per retirement
- Replacing Boy Scout code-debt scan — complementary, not merged
- Auto-closing tickets without specifier authority (BL-311)
- Rewriting historical briefings or `docs/archive/` contents

## Related

- `backlog/paused/BL-564-epic-spec-drift-realignment.yaml` — drift adjudication model
- `backlog/paused/BL-1013-epic-boy-scout.yaml` — on-demand clean-one-thing shape
- `backlog/paused/BL-818-epic-lean-aware-coordinator.yaml` — shift-close process loop
- `backlog/archive/INTAKE-postmortem-operator-verb-failure-class-learn.md` — learn registry input
- `docs/index.md` — `docs/archive/` note; extend with `docs/deprecated/`
