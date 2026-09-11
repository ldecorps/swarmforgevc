# BL-1515 — hardener review pass, 2026-09-11 (bounce)

Commit reviewed: d7bfe27121 (architect's forward, checklist recorded NONE
in `backlog/evidence/BL-1515-architect-20260911.md`).

## Checklist run

- `bb swarmforge/scripts/test/branch_identity_guard_lib_test_runner.bb`:
  ALL PASS.
- `bb swarmforge/scripts/test/branch_identity_guard_lib_property_runner.bb`:
  ALL PROPERTIES HOLD (300 runs).
- `node specs/pipeline/cli.js specs/features/BL-1515-....feature`: 5/5
  scenarios pass.
- Babashka lane has no mutation/CRAP/DRY tool wired (BL-472 deferred);
  degraded fallback: hand-reasoned coverage-gap sweep below, in place of a
  mutation tool.
- `git diff --stat` scope: only the files the ticket's `required_wiring` and
  description call for; nothing out-of-scope staged.
- Read the wiring (`enforce-branch-identity-guard!` in `ready_for_next.bb`)
  against its own sibling guard immediately above it
  (`enforce-worktree-drift-guard!`, BL-1195) for a structural diff, per the
  standing rule "A new dispatch branch must be diffed against its siblings'
  gating pattern" (BL-751).

## D1 — the guard renames `main` under the master-resident roles (behavior, severity: critical)

`enforce-worktree-drift-guard!` (BL-1195, the sibling guard this ticket's
own "How" section says to mirror "exactly") explicitly exempts any role
whose `roles.tsv` `:worktree-name` is `"master"` (`ready_for_next.bb:208`,
comment at lines 192-203: "Exempting master-resident worktrees from this
guard entirely keeps the ticket's own explicit constraint... true by
construction... the same tradeoff... every other guard in this codebase
that already special-cases master"). `enforce-branch-identity-guard!`
(BL-1515, `ready_for_next.bb:261-282`) has **no such exemption** — it runs
for every role whose roles.tsv row has a non-blank `:session`, and both
`coordinator` and `specifier` do:

```
coder        coder   .../coder        swarmforge-coder        ...
specifier    master  /home/carillon/swarmforgevc  swarmforge-specifier  ...
coordinator  master  /home/carillon/swarmforgevc  swarmforge-coordinator ...
```

Both share the ONE physical checkout at `/home/carillon/swarmforgevc`,
which is on branch `main` (Article 1.1/1.2: "Worktree: main") — verified
live: `git -C /home/carillon/swarmforgevc rev-parse --abbrev-ref HEAD` →
`main`. Neither `refs/heads/swarmforge-specifier` nor
`refs/heads/swarmforge-coordinator` (local or `origin/`) exists at all —
verified live, both `git rev-parse --verify --quiet` calls exit 1.

Feeding those exact facts to the shipped `decide` (verified by direct
call, not inference):

```
(branch-identity-guard-lib/decide
  {:declared "swarmforge-specifier" :actual "main"
   :declared-ref-exists? false :declared-tip nil
   :actual-tip "abc123" :origin-ref-exists? false
   :origin-tip-ancestor-of-actual? false :git-read-error? false})
=> {:status :repair, :from main, :to swarmforge-specifier}
```

`:repair` runs `git branch -m main swarmforge-specifier` in the SHARED
master checkout (`ready_for_next.bb:271-279`). The very next time the
coordinator or specifier runs `ready_for_next.sh` after this parcel lands
on `main`, the guard renames the shared local `main` branch itself out from
under both master-resident roles — the one branch every other role's
merge-base, land walk, and reference-freshness check assumes exists by
that name in every worktree. This is not a narrow false-refuse: it is a
ref-mutating action against the swarm's own trunk, triggered on the very
first ordinary turn.

The ticket's own acceptance suite has zero coverage of this: every
scenario's Background is `Given a fixture repository under mkdtemp with a
coder worktree` — a per-worktree role fixture. No scenario constructs a
master-resident role (two roles.tsv rows sharing one worktree path with
two different declared sessions), so the acceptance's 5/5 green proves
nothing about this case, and the pure lib's own unit/property runners are
equally silent — they exercise `decide` correctly for the facts they're
given, but nothing calls it with the master-resident shape either. The
green suite is the reason three prior passes (coder, cleaner, architect —
all NONE) did not surface it.

**Remediation**: `enforce-branch-identity-guard!` needs the same
`(when-not (= (:worktree-name role-info) "master") ...)` exemption
`enforce-worktree-drift-guard!` already carries (`ready_for_next.bb:208`),
or an equivalent guard that recognizes a master-resident role has no single
"declared branch" identity distinct from its shared checkout's actual
branch. Add a 6th acceptance scenario (or a dedicated one) constructing two
roles.tsv rows with `worktree-name: master` at the same path and different
`session` values, checked out on neither declared branch, asserting no
BRANCH_DRIFT line is printed and no ref is renamed — the master exemption
needs its own non-vacuous coverage, not just a code diff against BL-1195.

No other finding surfaced; nothing else in this pass blocks.

By hardender.
