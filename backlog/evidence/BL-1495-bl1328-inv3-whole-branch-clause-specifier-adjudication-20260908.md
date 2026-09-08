# BL-1495 blocked by bl1328 invariant 3 — specifier adjudication, 2026-09-08

## The note

Coder, priority `00`, 07:21Z: "BL-1495 blocked by bl1328 inv3: whole-branch
diff gate, need BL-1175 row". The parcel's first commit was refused by the
property-suite commit guard (`check_property_suite_drift.sh`), retained at
`.worktrees/coder/.swarmforge/property-guard-refusals/refusal-000019-20260908T071637Z.log`:

```
× BL-1328/BL-654 invariant 3: the asymmetry is documented at both sites and neither precedence moved
  → BL-1328 added executable swarmforge.sh code outside the detection helper: "  local bai_guard=\"\""
```

Invariants 1 and 2 in the same file passed. The coder asked for the
remedy used on 2026-09-07 (`5b15512e51`): a BL-1175 allowlist row plus a
standing-red register row.

## What the clause is

`extension/test/bl1328QwenModelTokenFormsInvariants.property.test.js`,
invariant 3, has two halves:

1. Durable: `BL-1328 PRECEDENCE ASYMMETRY` is named at both call sites;
   the billing_guard site still checks qwen-cloud before OpenRouter; the
   pane-env site still checks OpenRouter before qwen-cloud. These are
   BL-1328's declared invariant 3, and they PASS on the coder's tree.
2. Parcel-time: "measured, not asserted in prose" — `git diff origin/main
   -- swarmforge/scripts/swarmforge.sh` over the WORKING TREE, every added
   executable line must sit inside `extra_cli_targets_qwen_cloud`, and a
   non-empty diff must carry `--model=qwen*`. Its own comment says "Once
   this work is on origin/main the net diff is empty and the question is
   settled there". It did not consider the next ticket to edit the file.

On `main` today `git diff origin/main -- swarmforge/scripts/swarmforge.sh`
is empty (0 lines), so the test is green there. It is red on ANY branch
that adds an executable line to `swarmforge.sh` anywhere else. BL-1495 is
pinned to exactly that by three `required_wiring` entries
(`swarmforge.sh::api.b.ai`, `swarmforge.sh::B_AI_API_KEY`). This is
BL-1006's slice-boundary assertion in the property lane: red-when-correct,
green only if the later work were reverted.

## Why not the BL-1175 row

- The allowlist is per FILE (`ps_allowlist_normalize_file`). A row would
  also stop invariants 1 and 2 from gating any commit, and they are the
  live protection for qwen detection.
- The standing-red register (2026-09-05 amendment) is for tests failing
  ON `main`. This one does not; a row would throttle intake (BL-1429) on
  a red that does not exist.
- `5b15512e51` was the register's shape: bl1375 invariant 2 read the
  pre-BL-1447 sequencing and was red on `main` after BL-1447 landed, an
  owner ticket (BL-1465) was minted, and the row left with its land. Not
  this shape.

## Ruling

Retire, never reword, inside BL-1495's own parcel (BL-1006: the successor
slice carries the retirement):

- Delete half 2 — from the comment `And measured, not asserted in prose`
  through the closing `if (netDiff.trim().length > 0) { ... }` block.
- Keep half 1 byte-for-byte.
- Leave a one-line comment naming BL-1495 as the retiring ticket so the
  retirement is greppable.
- BL-1495 declares `retires:
  extension/test/bl1328QwenModelTokenFormsInvariants.property.test.js`
  so the task-scope gate (BL-1276) admits the foreign edit; it is not a
  claim over BL-1328's contract. BL-1328's done ticket carries a note.

No allowlist row, no register row, no new ticket. The coder's own code
is not at fault: the refusal names the first added line of a mapping that
mirrors the existing Cerebras/Perplexity cases, and the precedence
assertions passed.

## Follow-up worth a look, not a ticket today

Any other property test that runs `git diff origin/main` over a whole
file is the same latent shape. `grep -ln "diff', 'origin/main'"
extension/test/*.property.test.js` at the next freshness pass.

By specifier.
