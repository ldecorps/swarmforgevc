# BL-1195 hardener pass — bounce (2026-08-28)

## Gates run before finding the defect (all independently re-run, not
## taken on the architect's word)

| Gate | Result |
|---|---|
| `worktree_drift_lib_test_runner.bb` | ALL PASS |
| `worktree_drift_lib_property_runner.bb` (100 runs) | ALL PROPERTIES HOLD |
| `test_worktree_drift_guard.sh` (real-git, `coder`-style single-writer worktree) | 3/3 PASS |
| `run_acceptance.sh` (BL-1195's own feature) | 3/3 PASS |

Everything the ticket's own scenarios cover works correctly. The defect
below is a case none of them consider.

## D1 — the guard false-flags the coordinator/specifier's own legitimate
## turns whenever the OTHER master-resident role has uncommitted WIP

**Class:** correctness / behavior (violates the ticket's own explicit
constraint: "Must not false-flag a role's own legitimate in-progress
edits to a tracked file as drift (scenario 02)"). **Blamed role:** coder
(the guard's exemption logic in `worktree_drift_lib.bb`/wiring in
`ready_for_next.bb`).

### The gap

`enforce-worktree-drift-guard!` (`ready_for_next.bb`) computes
`git-root` via `git rev-parse --show-toplevel` and exempts drift only when
**the CURRENTLY INVOKING role's own** `in_process/` mailbox is non-empty.
Per the constitution's own role table (`PIPELINE.md`/`01_roles.md`), the
**coordinator** and **specifier** both use `master` as their worktree —
literally the SAME physical checkout, not one-worktree-per-role like every
other pipeline role. `ready_for_next.bb`'s own comment at line 135
acknowledges this ("a master-resident role's own worktree IS the shared
checkout") but the exemption check does not account for what that sharing
implies: **when specifier has legitimate, uncommitted, in-progress edits
on `main`** (drafting a spec file, editing a prompt/constitution file —
routine, constitution-sanctioned Article 1.2 work with no handoff parcel
involved at all) **and the coordinator's own turn starts at that moment
with no in_process parcel of its own**, the coordinator's guard sees
specifier's tracked-file diff, has no exemption for it, and refuses —
`WORKTREE_DRIFT_DETECTED`, exit 2. The reverse (specifier refused by
coordinator's WIP) is symmetric.

This is not a rare edge case. This session's own memory carries multiple
independent, already-documented incidents of exactly this shared-checkout
contamination class: `main-shared-with-coordinator.md`,
`untracked-master-wip-blocks-freshness-sync-recurring.md` (3rd
recurrence), `qa-main-checkout-has-live-uncommitted-work.md`,
`operator-tunnel-contamination-blocks-merge.md`,
`cursor-agent-commits-then-reverts-uncommitted-work-on-main.md`. The
`master` checkout is a KNOWN, RECURRING multi-writer surface; this guard's
underlying assumption (the invoking role's own in-progress task explains
everything modified in ITS worktree) is simply false there by design, not
merely fragile.

**Severity:** the coordinator's session must never exit (constitution
BL-107) and it is the swarm's central router — a guard that can spuriously
refuse its every turn (not the pane crashing, but the routine
`ready_for_next.sh` call every idle-loop and every wake depends on
returning `NO_TASK`/a task) whenever the specifier happens to have
mid-flight uncommitted edits is a standing reliability regression for
exactly the role the constitution protects most.

### Reproduction (real git, no mocks)

```bash
REAL_SCRIPTS_DIR="<repo>/swarmforge/scripts"
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

# Both master-resident roles point at the SAME root path.
printf 'coordinator\tcoordinator\t%s\tmain\tCoordinator\tclaude\tguard-boundary-only\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tmain\tSpecifier\tclaude\tguard-boundary-only\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'swarm_name\tprimary\nswarm_mode\tautonomous\n' > "$ROOT/.swarmforge/swarm-identity"

# specifier's OWN legitimate WIP - no handoff parcel involved (Article 1.2:
# specifier writes spec files directly), nothing committed yet.
echo "specifier drafting a new ticket spec, mid-edit" > "$ROOT/seed.txt"

# coordinator's own turn, with NO in_process parcel of its own:
cd "$ROOT" && SWARMFORGE_ROLE=coordinator bb "$ROOT/swarmforge/scripts/ready_for_next.bb"
```

### Actual output

```
rc=2
WORKTREE_DRIFT_DETECTED: tracked content in this worktree differs from its own HEAD with no in-progress task to explain it - this may be the same "silent revert, no authoring commit" shape as BL-1195's own incident. Preserve it, never discard or forward it:
  git stash push -u -m "worktree-drift-$(date -u +%Y%m%dT%H%M%SZ)"
Drifted path(s):
  - seed.txt
```

The coordinator is refused for content it never touched and has no way to
explain via its own mailbox — specifier's routine, legitimate WIP.

### Why I am not fixing this myself

The right fix requires a real design decision, not a mechanical patch:
should master-resident roles be exempted from this guard entirely (but
then the exact BL-1195 incident, if it recurred in the shared master
checkout instead of a per-role worktree, would go undetected again — the
very failure mode this ticket exists to catch)? Should "has-in-progress-
task?" union BOTH coordinator's AND specifier's `in_process/` mailboxes
for master-resident roles specifically (still leaves human/Cursor/
operator-tunnel edits on `main` unexplained, per this session's own
memory of those exact actors)? Something else? Choosing among these is
product-behavior design, squarely outside "Does Not Own: do not introduce
new product behavior" for a hardening pass — this is coder's fix to make
(escalating to specifier for the semantic call if they judge it needs
one, the same judgment call coder already exercised once on this very
ticket for the root-cause hypothesis).

### Scope note

Confirmed via the constitution's own role table that this defect class is
unique to the coordinator+specifier pairing — every other pipeline role
(coder/cleaner/architect/hardender/documenter/QA) has its own dedicated
`.worktrees/<role>`, exclusively written by that one role, so this exact
false-positive shape cannot occur there. Not proposing to widen the
ticket's scope beyond what this defect actually touches.

## Disposition

Bouncing to coder. Not forwarding to documenter. Recording per the
constitution's send-back protocol.

By hardender.
