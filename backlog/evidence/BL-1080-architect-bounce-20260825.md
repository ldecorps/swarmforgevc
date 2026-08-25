# BL-1080 — architect bounce (Article 4.4 inventory) — 20260825

Reviewed cleaner tip `fe9ae59af6` (coder `d569c8c7a` + DRY
`refuse_unsupported_agent`) on `origin/main`=`cb12bfd8ba` lineage.

## Scope

`origin/main...fe9ae59af6` = **7 paths**, BL-1080-only. Hitchhike CLEAN.
Pack `cursor-mono-router.conf` already on main; tip adds how-to, launcher
pointers, APS steps, ticket + evidence.

## Architecture — PASS (with acceptance/encoding gaps below)

- Shared `refuse_unsupported_agent` is the right shape (one message, two call
  sites) — prevents the BL-1018 one-site drift the ticket names.
- How-to commits Cursor vs `/pilot` vs Claude table; pack window lines name
  `cursor`. No extension/webview surface. Dep-gate N/A (shell/docs parcel).

## Inventory

### D1 — `acceptance` (blame: cleaner / coder)

Scenario 02 fails on this tip:

```
expected >1 site, got 1
```

`bl1080ChooseACursorSeatSteps.js` enumerates by grepping the literal
`Unsupported agent '$agent' for role '$role'` string. After cleaner DRY that
string appears once (inside `refuse_unsupported_agent`); `validate_agent` and
the launch `*)` arm only call the helper. Feature still requires more than
one refusal **site** (allow-list + launch-command builder).

Remediation: update enumeration to count both call sites (e.g. two
`refuse_unsupported_agent` call sites, or validate_agent + launch `*)`
paths) while still asserting the shared message names
`docs/how-to/BL-1080-choose-a-cursor-seat.md`. Re-run APS to **3/3** on the
DRY tip (cleaner evidence claimed 3/3 — not reproducible here).

### D2 — `invariant-unencoded` (blame: coder)

Two declared invariants; **no** `*.property.test.js` / babashka property
runner under the property suite.

1. Unsupported-agent error points at the Cursor-seat how-to — encode over
   the refusal family (shared helper text + ≥2 call sites), RED if how-to
   path dropped or a call site bypasses the helper.
2. Docs state Cursor vs `/pilot` vs Claude — ticket approval_context allows
   no Gherkin scenario for prose; still needs either a non-vacuous property
   over committed how-to headings/table OR an explicit **stated
   non-encodability reason** in the tip (none present).

## Property-testing support (undeclared) — BLOCKED BY D2

Do not author declared encoding here.

## Findings summary

| Item | Class | Blamed | Action |
|------|-------|--------|--------|
| D1 | acceptance | cleaner (DRY without APS step update); coder co-owns harness | bounce |
| D2 | invariant-unencoded | coder | bounce |

## Forward

`git_handoff` to `coder`, priority `00` — do **not** forward to hardender.
Use tip below only; ignore prior impure tip `8f5d220ac3` if queued.

By architect.
