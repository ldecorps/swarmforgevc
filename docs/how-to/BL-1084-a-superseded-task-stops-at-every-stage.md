# Supersede pre-turn guard — stop mid-flight work at every stage (BL-1084)

## The gap

A supersede used to be a **note to one role**. Commits already forwarded kept
moving: cleaner/architect/hardender/documenter/QA never saw the note, so
superseded work could still ship.

## The fix

A durable marker store on the shared project root:

```text
.swarmforge/superseded/<task-name>   # first line = reason
```

Every role's turn start (`ready_for_next.bb`, beside BL-640's freshness guard)
loads that store and peeks task names on parcels in `in_process/` and `new/`.
If a candidate task is recorded, the turn is **refused** (exit 2) and the
parcel is left in place — **not** a bounce.

| Store state | Outcome |
| --- | --- |
| Directory absent | Pass (nothing superseded) |
| Readable, task marked | Refuse with `SUPERSEDED: task … — <reason>` |
| Exists but unreadable | Refuse with `SUPERSEDE_STORE_UNREADABLE` (never treat as empty) |

## Operator actions

**Record a supersede** (by hand or tooling that writes the store):

```bash
mkdir -p .swarmforge/superseded
printf '%s\n' 'reframed to local-model' > .swarmforge/superseded/BL-1052-qwen-code-seat
```

**Clear a mistaken supersede:**

```bash
rm .swarmforge/superseded/BL-1052-qwen-code-seat
# then ready_for_next.sh again — dispatch resumes with no residue
```

## What you see

```text
SUPERSEDED: task BL-1052-qwen-code-seat is recorded as superseded — reframed to local-model.
Leaving the parcel in place; this is not a bounce.
Clear .swarmforge/superseded/BL-1052-qwen-code-seat by hand only if the supersede was recorded in error.
```

Acceptance: `specs/features/BL-1084-a-superseded-task-stops-at-every-stage.feature`.

Related: [Reference-freshness pre-turn guard (BL-640)](./BL-640-reference-freshness-guard.md),
`swarmforge/handoff-protocol.md` (Supersede pre-turn guard).
