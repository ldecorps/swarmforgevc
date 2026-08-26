# Isolating batch recovery trees (BL-588)

*How-to. Task-oriented: when one ticket in a batch commit fails, let clean
siblings land without waiting for the defective ticket's rework.*

[BL-532](BL-532-sibling-bounce-deferral-runbook.md) defers a clean sibling and
stops spurious re-queues, but the sibling still could not **land** while a
defective ticket in the same batch commit reworked — all tickets rode one tree
and QA could only approve or refuse the whole parcel.

BL-588 implements **approach 3** (human ruling 2026-07-23):

1. The **defective** ticket reworks on a branch cut from the **last clean
   ancestor** — not from the contaminated batch tip.
2. Each **clean sibling** re-forwards its parcel **unchanged** on the commit
   that already satisfied it on the shared batch, for whole-tree
   re-verification.
3. **QA lands** a clean sibling only by merging a **verified whole tree** —
   never cherry-pick, rebase-to-land, or partial-subset operations.

BL-532 deferral records (`.swarmforge/qa_deferrals/`) name which blocker each
clean ticket waits on and which commit proved the deferral.

## When to use

Use batch recovery after a **partial batch bounce**: a batch commit satisfies
tickets A and B, ticket A fails a check, ticket B has no failing check of its
own and carries an open BL-532 deferral pending A.

Without BL-588, B waits on A's rework even though B already passed every gate
on its own work. With BL-588, B can re-forward, pass QA as a whole tree, and
land on `main` while A reworks on an isolated branch.

## Recovery workflow

### 1. Confirm deferral state

```bash
node extension/out/tools/qa-sibling-check.js status --ticket BL-B
```

Expect exit 3 with `DEFERRED BL-B BLOCKED_BY BL-A CHECK …` while A is still
open.

### 2. Prepare clean sibling re-forward

```bash
node extension/out/tools/batch-recovery.js prepare-re-forward \
  --ticket BL-B \
  --defective-ticket BL-A
```

On success, prints JSON with `forwardCommit` — the same commit that satisfied
B on the shared batch. Send a separate `git_handoff` for B using that commit;
do not bundle A's recovery in the same handoff.

Exit 4 (`REFUSED: …`) when no open deferral links B to A.

### 3. Prepare defective ticket rework

Cut A's recovery branch from the last clean ancestor **before** the shared batch
tip:

```bash
node extension/out/tools/batch-recovery.js prepare-rework \
  --ticket BL-A \
  --batch-commit <10-hex-contaminated-tip> \
  --ancestor <10-hex-last-clean-ancestor>
```

On success, prints `branchBase` (the ancestor) and
`excludesContaminatedTip: true`. Rework A on that base; the contaminated batch
tip must not be the branch base.

### 4. QA verifies and lands the clean sibling

After B's unchanged parcel passes every gate as a whole tree:

**Refuse history-rewriting landings** (QA gate):

```bash
node extension/out/tools/batch-recovery.js validate-land \
  --operation cherry-pick \
  --verified-commit <10-hex>
# → REFUSED: landing must merge a verified whole tree
```

Only `--operation merge` is allowed.

**Validate merge-up names the verified tree:**

```bash
node extension/out/tools/batch-recovery.js validate-merge-up \
  --ticket BL-B \
  --verified-commit <10-hex-verified> \
  --landed-commit <10-hex-on-main>
```

**Confirm A's recovery branch is not pulled in with B's landing:**

```bash
node extension/out/tools/batch-recovery.js validate-land-isolation \
  --landed-commit <10-hex-on-main> \
  --defective-tip <10-hex-A-recovery-tip>
```

Then land B by merging the verified whole tree onto `main` per the normal
BL-247 QA integration path.

### 5. Clear deferral after B lands

Once B is on `main` and A's recovery is still isolated:

```bash
node extension/out/tools/qa-sibling-check.js clear \
  --ticket BL-B \
  --blocked-by BL-A \
  --commit <10-hex>
```

## Invariants (human ruling)

| Rule | Meaning |
| --- | --- |
| No history rewriting | QA never cherry-picks or rebases-to-land a "clean subset" |
| Whole-tree verification | Every ticket that lands was verified on the tree QA merges |
| Unchanged re-forward | Clean siblings forward the **same** commit that satisfied them on the batch |
| Isolated rework | Defective ticket's recovery branch excludes the contaminated batch tip |

Approach 1 (split batch commits per ticket) and approach 2 (QA cherry-pick
subset) were ruled out. Approach 4 (do nothing beyond BL-532) applies when
measured deferral latency is too small to justify this machinery.

## CLI reference

Run from the repo root after `npm run compile` in `extension/`:

```text
batch-recovery.js prepare-re-forward --ticket <id> --defective-ticket <id>
batch-recovery.js prepare-rework --ticket <id> --batch-commit <10-hex> --ancestor <10-hex>
batch-recovery.js validate-land --operation <merge|cherry-pick|…> --verified-commit <10-hex>
batch-recovery.js validate-merge-up --ticket <id> --verified-commit <10-hex> --landed-commit <10-hex>
batch-recovery.js validate-land-isolation --landed-commit <10-hex> --defective-tip <10-hex>
```

Exit codes: `0` success (JSON on stdout), `2` usage error, `4` refused
(`REFUSED: …` on stderr).

Core policy: `extension/src/quality/batchRecovery.ts`.

## Regression locks

- Unit / property: `extension/test/batchRecovery.test.js`,
  `extension/test/batchRecovery.property.test.js`,
  `extension/test/batchRecoveryCli.test.js`
- Acceptance: `specs/features/BL-588-isolate-batch-recovery-trees.feature`

## Siblings

- [BL-532 sibling bounce deferral runbook](BL-532-sibling-bounce-deferral-runbook.md) — deferral records, status/clear, stranded deferrals
- [Swarm workflow flow diagram](../diagrams/swarm-flow.mmd) — parcel topology note for partial batch recovery
