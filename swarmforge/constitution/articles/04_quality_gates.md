# Article 4: Quality Gates

## 4.1 Pipeline Gates
1. **Specifier** – Acceptance criteria defined.
2. **Architect** – Design review passed.
3. **Hardener** – 100% test coverage, no surviving mutants, CRAP <= 6.
4. **QA** – Final approval before merge.

## 4.2 Merge Criteria
- All gates must pass.
- No regressions in existing functionality.
- Documentation updated.
- QA integrates on `main` (lands the approved commit + pushes origin); the coordinator then does backlog bookkeeping only — no git merge/push (BL-247).

## 4.3 Rejection Protocol
- If a gate fails, the parcel is routed back to the role that OWNS the fix —
  the stage whose domain contains the defect, or whose required pass is
  missing entirely — with bounce evidence explaining the issue. Never
  reflexively to the coder: a doc-only defect or a missing documenter pass
  goes to the documenter (BL-425, BL-576, BL-575). Failure class labels the
  metric; ownership drives the routing. The full routing table lives in the
  QA role prompt's bounce evidence contract.
- WHERE a bounce goes is this section; WHEN it is complete enough to send is
  4.4 below.

## 4.4 Complete Review Inventory — One Bounce Per Review Pass
- A reviewing role (cleaner, architect, hardender, documenter, QA) must not
  send a parcel back at the FIRST defect it sees. Before any send-back it
  finishes its own full review checklist and sends **one** bounce carrying
  **every** defect that pass found — never one per defect, per property, or
  per site. The forbidden pattern has a name: **first-failure stop**. It turns
  N defects into N round-trips (BL-590: seven architect send-backs, one slice).
- **Complete means run-or-blocked, never assumed-clean.** A check you cannot
  execute because an earlier defect blocks it (unit behind a compile failure,
  mutation behind a red suite) is recorded as BLOCKED BY that defect — never as
  passing, never silently omitted. The pass is complete when every check the
  role owns is either run or explicitly blocked.
- **One evidence file, one inventory.** The bounce evidence file lists every
  defect as its own item `D1..Dn` with: **class**
  (`compile|unit|integration|acceptance|behavior|invariant-unencoded|spec-gap`),
  **blamed role** (whose output introduced it — 4.3 ownership), and a
  **remediation pointer** (file, function, scenario/property id) — plus the
  blocked-check list. A full sweep that found nothing records an explicit NONE
  and forwards.
- **One bounce, many owners.** When one inventory blames several stages, the
  single `git_handoff` goes to the EARLIEST blamed role (4.3) and the inventory
  travels with the parcel; any stage that later holds that parcel must clear
  the items blamed on IT before forwarding.
- **Spec gaps leave by `note`, and are not a second bounce.** A `spec-gap` item
  goes as a `note` (priority `00`) to specifier AND coordinator in the same
  pass — the specifier specifies only (Article 1.2), so it is never sent a
  parcel. If EVERY item is a spec gap there is nothing to bounce: complete the
  inbound task, send the note, and the specifier amends the spec on `main` and
  notifies the holder to merge and rebuild ("Amending An In-Flight Ticket's
  Spec").
- **Unchanged, and not exceptions**: BL-532 sibling deferral (a sibling with no
  failing check of its own is deferred, never bounced); a `rule_proposal` is a
  separate channel and never splits a bounce.
- **A genuinely new bounce is still allowed**: when the fix introduces new
  defects, or unblocks a check recorded BLOCKED and it then fails. Recording
  blocked checks is what keeps that case distinguishable from a
  first-failure-stop regression.
- Adoption record and rationale:
  `articles/reference/complete-review-inventory-amendment-2026-07-27.md`
  (operator directive 2026-07-27).
