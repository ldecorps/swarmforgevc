# BL-532: Understanding and Handling Sibling Bounce Deferrals

When a batch commit satisfies several tickets but a failure belongs to only some of them, the parcel with no failing check of its own is **deferred** instead of bounced. This runbook explains what that means, how to read and interpret deferral messages, and how to clear a deferral once the blocker is fixed.

## What is a Deferral?

A **deferral** is a machine-readable marker that says: *"This ticket's work is fine. It is waiting on another ticket to be fixed."*

Unlike a **bounce**, which sends work back for rework, a deferral acknowledges that:
- The ticket itself has no failing check of its own
- The failure belongs to a sibling ticket in the same batch
- The parcel is held pending the blocker, never re-queued

### Deferrals vs. Bounces

| Aspect | Bounce | Deferral |
|--------|--------|----------|
| **Meaning** | This ticket has a defect | This ticket is blocked by a sibling's defect |
| **Action taken** | Send work back for rework | Hold pending the blocker |
| **Evidence file** | Yes, recorded | No, not recorded |
| **Bounce tally** | Counted | Not counted |
| **Rework needed** | Yes | No |
| **Location** | `.swarmforge/qa_bounces/` | `.swarmforge/qa_deferrals/` |

## Reading a Deferral

When QA encounters a deferred ticket, you'll see output like:

```
DEFERRED BL-477 BLOCKED_BY BL-475 CHECK npm run test
```

This means:
- **BL-477** is deferred (no rework needed)
- **BL-475** is the blocker (the ticket with the actual defect)
- **CHECK**: `npm run test` is the check that fails on the blocker

The same check that fails on BL-475 prevents BL-477 from proceeding, even though BL-477's own code is clean.

## Deferral Workflow

### Step 1: QA Checks Ticket Disposition

When a batch parcel lands, QA first checks the disposition of each ticket:

```bash
qa-sibling-check.js status --ticket BL-477
```

**Possible responses:**
- **Exit 0**: `VERIFY BL-477` → no deferral, proceed with normal verification
- **Exit 3**: `DEFERRED BL-477 BLOCKED_BY BL-475 CHECK npm run test` → deferred; skip verification, send a note to the holding role

### Step 2: QA Notifies the Holding Role (Deferred Ticket)

When a deferral is active, QA sends a `note` to the role holding the deferred ticket, NOT a bounce `git_handoff`:

```
BL-477 deferred pending BL-475 (CHECK: npm run test). No rework needed.
```

The holding role acknowledges the deferral and waits. There is no automatic re-queue.

### Step 3: Blocker is Fixed

When the blocking ticket (BL-475) is fixed and re-sent to QA, QA re-runs the check that was failing:

```bash
qa-sibling-check.js clear --ticket BL-477 --blocked-by BL-475 --commit <hex>
```

### Step 4: Deferred Ticket Resumes

Once the blocker is cleared, the deferred ticket is verified normally on its next arrival.

## Recording a Deferral (QA only)

When QA finds a sibling with no failing check of its own during batch verification:

```bash
qa-sibling-check.js defer \
  --ticket BL-477 \
  --blocked-by BL-475 \
  --class integration \
  --check "npm run test" \
  --commit <10-hex>
```

**Parameters:**
- `--ticket`: The clean ticket being deferred
- `--blocked-by`: The blocker ticket with the actual defect
- `--class`: Failure class from the blocker (`compile|unit|integration|acceptance|behavior`)
- `--check`: The exact command that fails on the blocker (e.g. `npm run test`)
- `--commit`: The parcel commit being tested (10 hex characters)

The deferral is recorded to `.swarmforge/qa_deferrals/<YYYY-MM>.jsonl` (not counted in bounce statistics).

## Clearing a Deferral (QA only)

When the blocking ticket is fixed and the blocker's check now passes:

```bash
qa-sibling-check.js clear \
  --ticket BL-477 \
  --blocked-by BL-475 \
  --commit <10-hex>
```

After clearing, `status --ticket BL-477` will return exit 0 `VERIFY`, and normal verification resumes.

## Multiple Blockers

A ticket can have multiple open deferrals (blocked by different tickets):

```
DEFERRED BL-477 BLOCKED_BY BL-475 CHECK npm run test
DEFERRED BL-477 BLOCKED_BY BL-476 CHECK npm run compile
```

If you clear only BL-475, the ticket is still deferred:

```
DEFERRED BL-477 BLOCKED_BY BL-476 CHECK npm run compile
```

All blockers must be cleared before the deferred ticket can proceed to verification.

## A Deferred Ticket with Its Own Defect

If a deferred ticket fails a **different check** than the blocker's, it is that ticket's own defect and goes through the normal bounce ritual — the deferral does **not** suppress it:

**Scenario:**
- BL-477 is deferred pending BL-475 (CHECK: `npm run test`)
- BL-477 fails `npm run compile` (a different check)

**Action:** BL-477 is bounced normally for its compilation defect (not deferred), while BL-475's `npm run test` failure is handled separately.

## Distinguishing from a Bounce

### Deferral Indicators
- **Output**: `DEFERRED <ticket> BLOCKED_BY <blocker>`
- **Location**: `.swarmforge/qa_deferrals/` directory
- **Effect**: Ticket is held, no rework `git_handoff` sent
- **Tally**: Invisible to bounce statistics
- **Next action**: Clear the blocker, re-verify

### Bounce Indicators
- **Output**: Evidence file written to `.swarmforge/evidence/`
- **Location**: `.swarmforge/qa_bounces/` for records
- **Effect**: `git_handoff` sent back to the appropriate role
- **Tally**: Counted in QA-bounce metrics
- **Next action**: Role reworks and re-sends

## Checking Deferral Status

As a developer (not QA), you can check a ticket's deferral status:

```bash
qa-sibling-check.js status --ticket BL-477
```

**Exit codes:**
- `0`: No deferral; ticket is ready to verify
- `3`: Deferred; output names the blockers and their checks
- `2`: Usage error (missing flag, invalid ticket id)

## Deferred Tickets in the Backlog

Deferred tickets may sit in the pipeline longer than bounced tickets because:
- They are waiting for an external blocker (sibling ticket), not their own rework
- Clearing a deferral is a passive operation (the blocker is fixed elsewhere)
- There is no automatic re-queue or re-send

If a deferred ticket sits for an unusual time, check whether the blocking ticket is actually progressing. If the blocker is stalled, the deferred ticket will remain stalled until the blocker moves.

## Troubleshooting

### "Unknown ticket" when running status

If `qa-sibling-check.js status --ticket BL-477` returns exit 0 `VERIFY` for a ticket you expect to be deferred:
- The deferral record may have been cleared
- The ticket may have arrived before any deferral was recorded
- The `.swarmforge/qa_deferrals/` directory may not exist or may be empty

### "BLOCKED_BY" names the wrong blocker

Deferral records are written by QA based on the actual failure observed. If the output names a different blocker than you expected:
- Verify which ticket actually failed (the blocker) in the commit tree
- Check the QA logs or evidence files to see what QA observed
- The deferral is correct; the failure may have a different source than expected

### Clearing a deferral has no effect

After clearing with `qa-sibling-check.js clear`, if `status` still shows the deferral:
- Verify the blocker is actually fixed (re-run the blocker's check manually)
- Check that the `clear` command used the correct `--blocked-by` ticket id
- Ensure the commit hash matches the version you tested

If the blocker check is still failing, the deferral will remain until the check passes and is cleared again.
