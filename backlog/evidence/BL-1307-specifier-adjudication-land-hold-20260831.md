# BL-1307 — specifier adjudication of QA's land hold

QA's note (priority `00`, `20260830T232437Z_002029`) held BL-1307 rather than
landing it, naming
`backlog/evidence/BL-1307-qa-hold-land-step-blind-spot-20260831.md`.

## The hold is upheld. BL-1307 parks intact; it is NOT a bounce.

No defect was found in BL-1307's own work, and none of the roles in its chain
owns the tooling at fault. QA was right on both refusals:

- **Not a bounce.** Article 4.3 routes a failed gate to the role that owns the
  fix. `land_step_lib.bb` / `task_scope_gate_lib.bb` are shared swarm
  machinery, not BL-1307's deliverable. Bouncing to coder/architect/hardener/
  documenter would charge them for a defect none of them authored.
- **Not a hand-roll.** Stripping BL-1300's four paths out of the replay tip by
  hand is exactly what QA.prompt forbids, and it would leave the detection gap
  live for the next parcel of the same shape.

## Every git claim in QA's report re-verified independently

The specifier did not take the report on trust. Re-run against the live repo:

| Claim | Result |
|---|---|
| `rev-list --first-parent origin/main..bd27e884cb` sees `9553cf9354`/`3fe063d3ad` | **0 hits** — invisible |
| Those two commits are ancestors of `bd27e884cb` | **both are** — reachable, just not first-parent |
| Replay `c251bb4b666d` contains BL-1300 files | **4 files**, incl. a +107-line step-handler change |
| `origin/main:extension/test/bl1300HeadroomProofIsPinned.test.js` | **absent** |
| BL-1300 `human_approval` | **pending**, deliberately held for a human ruling |

Source read directly: `ancestry-commits` at `land_step_lib.bb:71-72` (used at
`:165`) walks `--first-parent`; `own-commit-changed-paths` `:delivered` at
`task_scope_gate_lib.bb:363-364` diffs a merge against its first parent. The
asymmetry is real and is in the code, not inferred from the symptom.

## Disposition

1. **BL-1307 stays parked at QA, intact and unlanded.** It lands unchanged once
   BL-1300 has landed — at that point BL-1300's four files are on `origin/main`,
   the replay's inclusion of them becomes byte-identical rather than novel, and
   the cited commit needs no re-work. Nothing about BL-1307 is rebuilt.
2. **Do not re-cite a different commit to get around it.** Citing an upstream
   non-merge commit narrows the candidate set and silently replays a PARTIAL
   parcel — strictly worse than the loud hold.
3. **BL-1308 minted** (`backlog/paused/`, `severity: high`, priority 5) for the
   detector/path-set asymmetry, so the next parcel of this shape is caught by
   the tool rather than by a human reading a replay diff.

## The transitive blocker is human, and it is the one worth surfacing

BL-1307 is blocked on BL-1300; BL-1300 is blocked on a human ruling tap. Both
active slots are therefore held by tickets that are green and waiting on the
same decision. That is the throughput fact to escalate — not a swarm fault.

By specifier.
