# BL-1185 — architect bounce — 20260827

**Reviewed tip:** tip-pure cleaner `0ad7d68aa` → architect `8fa2a5c2f`
(inbound `c2b9994abf` ancestry merge). Tip purity OK.
**Handoff:** `00_20260827T090030Z_000990_from_cleaner_to_architect`

## Verdict

**Bounce → coder.** Functional wiring and APS are green; declared invariants
are not property-encoded (BL-633 / BL-654).

## Tip purity / architecture (informational — not bounce items)

- `task-name-for-difficulty` reuses `supersede-lib/task-name-from-content`;
  does not stamp `task:` onto notes — matches ticket Shape.
- Tip paths are BL-1185-only.

## Gates that ran green (not bounce items)

| Check | Result |
|-------|--------|
| `seat_difficulty_lib_test_runner.bb` | ALL PASS |
| `supersede_lib_test_runner.bb` | ALL PASS |
| APS BL-1185 feature | **4/4** |

## Inventory

### D1 — `invariant-unencoded` (blame: coder)

**Invariants (all three undeclared as properties / no non-encodability reason):**

1. Work BL-… notes resolve a task name for seat difficulty when `task:` is absent
   (same attribution supersede_lib uses).
2. A high `mutation_cost` ambulance patient is not stranded on a hard seat solely
   because the Work note omitted `task:`.
3. `task:` remains git_handoff-only — Work route notes stay `type: note` without
   a task header.

**Repro:** Parcel adds `task-name-for-difficulty` + APS steps only. No
`*.property.test.js` / babashka `*_property_runner.bb` quantifying these over
generated Work-note bodies / difficulty decisions. Ticket YAML and cleaner
evidence state no non-encodability reason.

**Remediation:** Encode each invariant as a non-vacuous property (break-then-fix),
or document non-encodability on the ticket/evidence when a surface truly cannot
be quantified. Prefer generative coverage of `task-name-for-difficulty` /
`difficulty-allows-claim?` over example-only APS.

By architect.
