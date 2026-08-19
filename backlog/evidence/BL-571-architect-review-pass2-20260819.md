# BL-571 — architect review pass 2 (re-fix): complete inventory

- **Ticket**: BL-571 `rotation sequential` packs are invisible to ensure's declared signal
- **Commit reviewed**: `87d4c64013` (cleaner re-fix) — merged as `21a745eae`
- **Reviewer**: architect, 2026-08-19
- **Prior bounce**: pass 1, `bbb14382d8`, class `behavior` —
  `backlog/evidence/BL-571-sequential-rotation-dormant-parity-bounce-20260819.md`
- **Verdict**: **PASS — D1 closed, defects found: NONE.**

## D1 is closed, and I verified the gate bites rather than trusting the claim

Pass 1's D1: `single-resident-rotation-values` (`mono_router_lib.bb`) mirrors
`swarmforge.sh`'s `is_sequential_dormant` across a bash↔Babashka boundary no import
can bridge, held together only by a docstring — the BL-897 guardrail's
"kept in sync comment is not a gate".

The re-fix (`af2dd1b249`) adds a real gate in `mono_router_lib_test_runner.bb`. It
does not restate the constant; it **derives** the launcher's accepted set by parsing
`is_sequential_dormant`'s own body out of `swarmforge.sh`
(`"$ROTATION_MODE" == "<value>"` literals) and asserts **set equality** with the
Babashka set, so drift in *either* direction fails. Three things make it robust:

- an explicit non-empty assertion, so a regex that rots into matching nothing fails
  rather than passing vacuously;
- a functional sweep that `source`s the real launcher and confirms every derived
  value is genuinely accepted, plus a control value (`classic`) that must be rejected —
  so the textual derivation cannot drift away from runtime behaviour;
- fixture cleanup in a `finally`, and a short `/tmp` root (macOS's long `$TMPDIR`
  overflows the 100-char unix-socket limit).

**Non-vacuity proven by me, not accepted on assertion.** I added a third value to the
**bash side only** and re-ran the gate:

```
FAIL: BL-571 D1 parity gate: the launcher's accepted rotation-value set equals
      single-resident-rotation-values exactly (widen BOTH sides together - BL-897)
  expected: #{"sequential" "router" "rotate"}
  actual:   #{"sequential" "router"}
GATE_EXIT=1
```

`swarmforge.sh` was restored byte-exact afterwards (`git status` clean for that path).
The gate is load-bearing.

## My pass-1 S1 spec gap was actioned

Pass 1 left an S1 `note` (priority `00`, specifier + coordinator): the declared
invariant's property runner was absent from `qa_e2e_procedure`, so a QA pass following
it literally would never run the invariant's own gate. The specifier amended the
procedure — `bb swarmforge/scripts/test/bl571_single_resident_rotation_property_runner.bb`
is now step 3. Closed.

## Checks run — full inventory

| # | Check | Result |
|---|---|---|
| 1 | Merge lineage (`87d4c64013` ancestor of HEAD) | PASS |
| 2 | **Re-fix not silently suppressed by my own earlier revert (BL-954 trap)** | PASS — `swarm_ensure.bb` auto-merged; verified it carries the widened `single-resident-rotation?` predicate, not my reverted narrow one |
| 3 | Bounced BL-958 / BL-960 content kept out | PASS — sender's branch still carries both; verified `control_plane_lib` absent, 0 refs in all four consumers, `safe-wrapper-command` 0 refs |
| 4 | Operator hook disable still intact after merge | PASS |
| 5 | Ticket-YAML conflicts resolved as UNIONS | PASS — my `bounce_history` + the specifier's spec-gap amendments both kept on all three tickets; all three parse and retain their bounce entry |
| 6 | **Dependency gate (hard gate)** | PASS for this parcel — only the pre-existing BL-759 `telegram-*` `acyclic` cycle; no parcel file is in it |
| 7 | D1 remediation present and non-vacuous | PASS — proven by break-and-restore above |
| 8 | Declared invariant encoded as a property test | PASS — `bl571_single_resident_rotation_property_runner.bb`: 500 runs, reachability 246 positive / 120 sequential / 254 negative |
| 9 | `mono_router_lib_test_runner.bb` | PASS |
| 10 | Scope discipline — `conf-rotation-router?` / `rotation-router-from-identity?` left router-only for the ROTATE_HOME backstop | PASS — explicitly pinned by two negative assertions |
| 11 | Multi-site closure (other `ROTATION_MODE` comparisons in `swarmforge.sh`) | NOT A DEFECT — the ticket scopes itself to `rotation-router-mode?` only and defers the six-site closure to its own ticket |
| 12 | `zsh` used to source the launcher in the gate | PASS — `swarmforge.sh` is itself `#!/usr/bin/env zsh` and the existing suite (`test_alternate_runtime_launch.sh`) already sources it with `zsh -c`; the bash-3.2 rule governs our own bash test scripts, not the product script's interpreter |
| 13 | `test_swarm_ensure.sh` (incl. the re-admitted BL-571 case) | PASS — suite reports **ALL PASS** |
| 14 | `test_rotation_sequential_pack.sh` | **BLOCKED BY a pre-existing environment limit, not by this parcel** — `resolve_swarm_socket.bb` refuses a 102-char fixture socket path (macOS 100-char unix-socket limit, long `$TMPDIR`, no `XDG_RUNTIME_DIR` fallback). Neither that test nor `resolve_swarm_socket.bb` is touched by this parcel (test is BL-448; socket move is BL-367). Recorded blocked rather than passing or omitted, per Article 4.4. |
| 15 | Two-layer boundary / secrets / host owns I/O | PASS — swarm machinery only |
| 16 | Architect property-coverage pass | No new property required — the single declared invariant already carries a 500-run property runner with asserted reachability floors, and D1's remediation is a parity gate whose non-vacuity I verified directly |

## Note for the hardener / documenter

The pre-existing `test_rotation_sequential_pack.sh` blockage (item 14) is worth its own
ticket: it is the suite that most directly exercises `is_sequential_dormant`, and on this
host it cannot run at all. The parity gate added by this parcel already demonstrates the
fix shape — allocate the fixture root under a short `/tmp` path rather than `$TMPDIR`.
