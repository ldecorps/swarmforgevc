# BL-968 — verbatim PRE_QA_GATE acceptance-contract warning (documenter, 3/3 sends)

Requested by coordinator note `ad4d26201` ("not reproducible here"). Captured
by the documenter on 2026-08-20 from `swarm_handoff.sh` runs in
`.worktrees/documenter`. Related mint: **BL-968** (`cc870cfea`, specifier) —
three step files bind git at module load.

## Verbatim line (identical on all three sends)

```
PRE_QA_GATE WARNING: acceptance-contract:BL-960 step registry could not be loaded at the cited commit (Command failed: git rev-parse --git-common-dir
fatal: not a git repository (or any of the parent directories): .git
)
```

The ticket id is the only text that varies. Occurrences:

| ticket | cited commit | outbox parcel |
|---|---|---|
| BL-957 | `d166b82fd0` | `…000215` |
| BL-958 | `bc9f276c06` | `…000217` |
| BL-960 | `0f58bd6c11` | `…000220` |

Note the message is emitted on the run that **succeeds** — it is a WARNING,
the check fails OPEN, and delivery proceeds (`EXIT: 0`,
`HANDOFF DELIVERED:`). It is not accompanied by a `PRE_QA_GATE_FAIL` line.

## Why it may not reproduce elsewhere

Two observations that may explain a non-reproduction, offered as data rather
than diagnosis:

1. **It is not the sender's cwd.** The warning appeared on runs where the
   invoking shell's own `pwd` and `git rev-parse --git-common-dir` both
   resolved correctly — verified in the same command as the send:

   ```
   /Users/ldecorps/projects/swarmforgevc/.worktrees/documenter
   /Users/ldecorps/projects/swarmforgevc/.git
   ```

   So the failing `git rev-parse` runs from some other working directory
   inside the check, not from the caller's.

2. **It is not the documented benign cause.** `pre_qa_gate` docs name an
   uncompiled `extension/out/` as the usual reason a registry will not load.
   `extension/out/` was compiled here throughout (`extension/out/tools/`
   populated), and `specs/pipeline/stepRegistry.js` was present.

## How it was easy to miss

Worth recording because it cost this role three wrong diagnoses: piping the
send through `tail -N` hides it. `error-report` prints `HANDOFF INVALID` and
the error list BEFORE a ~22-line usage block, so `tail -25` keeps the
boilerplate and discards both the warning and the real findings. Piping also
replaces the script's exit code with `tail`'s, so a genuine exit 2 reads as
`exited with code 0`. Run `swarm_handoff.sh <draft>` unpiped when diagnosing.
