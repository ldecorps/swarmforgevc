# Article 4: Quality Gates

## 4.1 Pipeline Gates
1. **Specifier** – Acceptance criteria defined; every minted ticket
   satisfies INVEST (Independent, Negotiable, Valuable, Estimable, Small,
   Testable) at mint — a failing letter is split or refused, never shipped
   oversized for the coder to discover by bouncing (specifier prompt,
   human directive 2026-08-14).
2. **Architect** – Design review passed.
3. **Hardener** – 100% test coverage, no surviving mutants, CRAP <= 6.
4. **QA** – Final approval before merge.

## 4.2 Merge Criteria
- All gates pass; no regressions; documentation updated. QA integrates on
  `main` (lands the commit + pushes); coordinator bookkeeps only — no git
  merge/push (BL-247). See **complete-review-inventory-amendment-2026-07-27.md**
  §9 for the full pre-trim wording.

## 4.3 Rejection Protocol
- A failed gate routes back to the role that OWNS the fix (the stage whose
  domain has the defect, or whose required pass is missing) — never
  reflexively to the coder (a doc-only defect goes to the documenter;
  BL-425, BL-576, BL-575). Failure class labels the metric; ownership drives
  routing (full table: QA role prompt's bounce evidence contract). WHERE a
  bounce goes is this section; WHEN it is complete enough to send is 4.4
  below. See **complete-review-inventory-amendment-2026-07-27.md** §9 for
  the full pre-trim wording.

## 4.4 Complete Review Inventory — One Bounce Per Review Pass
- A reviewing role never bounces at the FIRST defect (**first-failure stop**,
  BL-590) — finish the full checklist, send **one** bounce with **every**
  defect. Complete means run-or-blocked (never assumed-clean): a blocked
  check is recorded BLOCKED BY its blocker, never passing/omitted. One
  evidence file, items `D1..Dn` (class, blamed role, remediation pointer); a
  clean sweep records NONE and is COMMITTED (forward names that commit,
  never the bare received hash — BL-536, gate BL-806). Multi-stage blame:
  bounce to the EARLIEST role, inventory travels, each stage clears its own
  items. Spec gaps leave by `note` (priority `00`, specifier+coordinator —
  never a parcel). BL-532 sibling deferral and `rule_proposal` are unchanged
  exceptions; a fix introducing new defects is a legitimate new bounce. See
  **complete-review-inventory-amendment-2026-07-27.md** for the full
  pre-trim wording, adoption record, and operator directive 2026-07-27.
