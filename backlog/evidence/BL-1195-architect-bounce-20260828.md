# BL-1195 architect pass — bounce (2026-08-28, re-fix round)

## Reviewed commit

`58e6f7d92c` (coder re-fix for hardener bounce D1), via cleaner merge
`fae547cc21`, merged clean into architect.

## D1 — the re-fix does not close the hardener's own reproduction

**Class:** behavior (the fix's regression test was quietly narrowed to a
scenario the fix DOES handle, while the literal case hardener reproduced
and bounced on is still broken). **Blamed role:** coder.

### What the hardener actually reproduced

Hardener's bounce (`backlog/evidence/BL-1195-hardener-bounce-20260828.md`,
commit `dfd885f9f`) reproduced the false-flag with specifier's WIP having
**no in_process handoff at all** — comment in the repro says explicitly
"specifier's OWN legitimate WIP - no handoff parcel involved (Article 1.2:
specifier writes spec files directly)". Both `.../specifier/inbox/in_process`
and `.../coordinator/inbox/in_process` are created empty and never
populated. That is a real, recurring shape: Article 1.2 spec/prompt
drafting and the Backlog Intake Order's root-drain both happen without any
dispatched parcel.

### What the fix actually does

`master-resident-sibling-has-in-process-parcel?`
(`swarmforge/scripts/ready_for_next.bb`) only widens the exemption's
SOURCE — it unions the sibling master-resident role's `in_process`
mailbox into the same "has an in-progress **parcel**" check the guard
already did. If NEITHER master-resident role has an in_process handoff —
exactly hardener's own repro — the union is still empty and the guard
still refuses.

### Reproduction (hardener's ORIGINAL repro, run verbatim against the shipped fix)

```bash
REAL_SCRIPTS_DIR=".../swarmforge/scripts"
ROOT="$(mktemp -d)"
git -C "$ROOT" init -q -b main
mkdir -p "$ROOT/swarmforge/scripts"
echo "seed" > "$ROOT/seed.txt"
printf '.swarmforge/\n' > "$ROOT/.gitignore"
git -C "$ROOT" add seed.txt .gitignore
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q -m base
cp "$REAL_SCRIPTS_DIR"/*.bb "$REAL_SCRIPTS_DIR"/*.sh "$ROOT/swarmforge/scripts/"

mkdir -p "$ROOT/.swarmforge" \
         "$ROOT/.swarmforge/handoffs/coordinator/inbox/"{new,in_process,completed} \
         "$ROOT/.swarmforge/handoffs/specifier/inbox/"{new,in_process,completed}

printf 'coordinator\tmaster\t%s\tmain\tCoordinator\tclaude\tguard-boundary-only\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tmain\tSpecifier\tclaude\tguard-boundary-only\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

# specifier's OWN legitimate WIP - NO handoff parcel dropped anywhere.
echo "specifier drafting a new ticket spec, mid-edit" > "$ROOT/seed.txt"

cd "$ROOT" && SWARMFORGE_ROLE=coordinator bb "$ROOT/swarmforge/scripts/ready_for_next.bb"
```

### Actual output (run directly against the shipped fix, 2026-08-28)

```
WORKTREE_DRIFT_DETECTED: tracked content in this worktree differs from its own HEAD with no in-progress task to explain it - ...
Drifted path(s):
  - seed.txt
rc=2
```

Identical to the pre-fix behavior. The coordinator is still refused for
specifier's routine WIP.

### Why the shipped regression test passed anyway

`test_worktree_drift_guard_master_resident_sibling.sh` scenarios 04/05
both call `drop_handoff` to populate the sibling role's `in_process`
mailbox before asserting no false-flag — i.e. they test "sibling role is
mid-parcel", not "sibling role has legitimate WIP with no parcel at all",
which is the scenario hardener actually reproduced and the scenario the
ticket's own constraint ("must not false-flag a role's own legitimate
in-progress edits... Article 1.2 spec/prompt drafting") describes. The
test's own comment rationalizes a different discrepancy (roles.tsv column
format) but does not address that the underlying reproduced scenario
changed shape.

### Remediation

Either: (a) exempt master-resident worktrees from this guard's drift
check entirely for now, accepting that a BL-1195-shaped silent revert in
the shared `master` checkout goes undetected until a real per-role
attribution mechanism exists (a scope-narrowing decision the specifier
should bless, since the ticket's own deliverable 2 wants the guard "even
if deliverable 1 cannot pin an exact mechanism"); or (b) find a real
signal for "this master-resident role is doing legitimate direct work"
that does not depend on a dispatched parcel — e.g. treat ANY
uncommitted change made by the CURRENT run's own recent file-write
activity as legitimate (harder, more design work). Either way this is a
design decision outside a mechanical patch, same posture hardener
correctly declined to fix itself under "no new product behavior."
Sending back to coder rather than fixing it myself, per this role's own
"does not own production code" boundary.

## Everything else checked this pass

- `worktree_drift_lib_test_runner.bb` — ALL PASS (unchanged, lib itself
  not touched by the re-fix).
- `worktree_drift_lib_property_runner.bb` (100 runs) — ALL PROPERTIES
  HOLD (unchanged).
- `test_worktree_drift_guard.sh` (original, single-worktree scenarios) —
  3/3 PASS, no regression from the re-fix.
- `test_worktree_drift_guard_master_resident_sibling.sh` (new) — 3/3 PASS
  as shipped, but see D1: the scenarios it covers are narrower than what
  they claim to fix.
- No `extension/` files touched by this re-fix; dependency-cruiser gate
  N/A.
- Co-change: `ready_for_next.bb`'s history shows expected coupling to its
  own test/wiring family; nothing new or concerning introduced by this
  diff specifically.
- BL-1199 (the sibling parcel also in my inbox this pass) reviewed
  separately and forwarded clean — see
  `backlog/evidence/BL-1199-architect-pass-20260828.md`.

## Disposition

Bounced to coder. Do not forward to hardener.
