# BL-1884 architect bounce — 2026-10-08

Commit reviewed: af3d3a7de8 ("BL-1884: refuse a new test-lane register row
whose owner declares no hotfix_fallback", By coder)

## D1 — `owner_declares_fallback`'s needs-ruling check accepts almost any
ticket, defeating the gate's own stated purpose (CORRECTNESS, blocking)

`swarmforge/scripts/check_standing_red_register.sh`'s new
`owner_declares_fallback()` (added lines ~77-116) judges the `needs-ruling`
case with:

```sh
needs-ruling)
  printf '%s\n' "$yaml" | grep -E '^ruling_options:' | grep -qE ':.+' || \
    printf '%s\n' "$yaml" | grep -E '^[[:space:]]*-[[:space:]]*[^[:space:]]' | grep -q .
  ;;
```

The fallback branch (after `||`) does not require the bullet list to
belong to `ruling_options:` — it matches **any** indented `- ` list item
anywhere in the owner ticket's YAML. Every real ticket in this project
carries at least one such list (`invariants:`, `required_wiring:`,
`out_of_scope:`, …), so a ticket that declares
`hotfix_fallback: needs-ruling` with **no `ruling_options:` field at all**
still passes as long as it has any other bulleted field — which is true of
essentially every ticket this swarm mints, including BL-1884's own YAML.

This defeats the ticket's declared invariant ("A commit never adds a
test-lane register row whose owner ticket does not declare a valid
hotfix_fallback") for the entire needs-ruling path, which is one of only
two valid fallback shapes the gate exists to enforce. It is also exactly
the kind of invisible-fallback gap the human's 2026-10-02 directive (this
ticket's own `source:`) asked to close.

### Repro (confirmed on this commit, not a hypothetical)

```sh
mkdir -p /tmp/bl1884-poc && cd /tmp/bl1884-poc
git init -q -b main && git config user.email t@t && git config user.name t \
  && git config commit.gpgsign false
mkdir -p backlog/paused backlog/active backlog/done swarmforge/scripts
cat > backlog/paused/BL-5000-owner.yaml <<'EOF'
id: BL-5000
title: "owner ticket"
hotfix_fallback: needs-ruling
invariants:
  - "some invariant unrelated to ruling_options"
  - "another invariant"
EOF
printf '' > backlog/standing-reds.tsv
printf '' > backlog/hardening-debt-ledger.yaml
printf 'file\tdisposition\trationale\n' > swarmforge/scripts/property_suite_standing_allowlist.tsv
git add -A && git commit -q -m init
printf 'unit\tnewred.test.js\tBL-5000\t2026-10-01\tfixture\n' >> backlog/standing-reds.tsv
git add -A
bash <checkout>/swarmforge/scripts/check_standing_red_register.sh
echo "EXIT: $?"
```

Result: `EXIT: 0` (accepted). Expected: refused, naming the row and the
missing `ruling_options`. The owner ticket declares `needs-ruling` and has
**zero** `ruling_options:` — the acceptance is entirely because of the
unrelated `invariants:` bullet list.

### Why no test caught this

Every fixture that exercises the `needs-ruling` path — the acceptance
feature's step handler (`bl1884RegisterRowDeclaresFallbackSteps.js`,
`declares hotfix_fallback needs-ruling without ruling_options` →
`id: BL-5000\nhotfix_fallback: needs-ruling\n`) and the shell test's own
case 11 — writes a minimal two-line owner YAML with **no other field**, so
the always-true fallback branch is never exercised. A realistic owner
ticket (which always carries `invariants:`/`required_wiring:`/etc.) was
never tried.

### Remediation

Scope the bullet-list check to the `ruling_options:` block specifically —
e.g. read from the `ruling_options:` line to the next top-level
(non-indented) key and check that span for at least one `- ` item, rather
than grepping the whole file for any bullet anywhere. Then extend the
shell test (and/or the acceptance fixture) with a case whose owner YAML
also carries an unrelated list field (e.g. `invariants:`) alongside a
bare `hotfix_fallback: needs-ruling` with no `ruling_options:`, to prove
the fix actually scopes the check.

No other site in this parcel implements this pattern — one function, one
fix.

## Full checklist otherwise clear

- Dependency-rule checker: N/A, no TS/JS production files touched (shell +
  Babashka only).
- Co-change: N/A, same reason; the two touched files (the guard and its
  shell test) are each other's only expected co-change.
- Invariant 2 ("the forward check and ... agree", N/A — this ticket
  declares one invariant only) is otherwise correctly implemented: the
  multi-sitting branch, the hardening-lane exemption (scenario 04), and
  the already-on-main exemption (scenario 03, pre-existing BL-1646 logic,
  untouched) all read correctly and are exercised by both the acceptance
  feature and the shell test.
- `test_check_standing_red_register.sh`: 12/12 (including the 6 new BL-1884
  cases). `node specs/pipeline/cli.js` on the ticket's acceptance feature:
  6/6. Both green, but neither reaches D1 (see above).
