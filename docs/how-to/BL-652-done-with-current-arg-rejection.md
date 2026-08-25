# `done_with_current.sh` refuses every argument (BL-652)

`done_with_current.sh` completes the current in_process parcel (task mode) or
archives the whole in_process batch (batch mode). It previously dropped argv
in `dispatch_lib.bb`'s `run-helper!`, so a usage probe like
`done_with_current.sh --help` still ran the full destructive completion —
including archiving unworked batch items and chaining `ready_for_next`.

## Contract

The done_with_current family takes **no arguments**. Any argv (including
`--help`, `-h`, or junk) fails fast:

- non-zero exit (exit 2)
- usage text: `Usage: done_with_current.sh takes no arguments`
- **no** completion side effects (nothing moved, no `completed_at`, no
  ready_for_next / idle-boundary, no rotation)

Wired on entry (`done_with_current.bb`) and on both helpers
(`done_with_current_task.bb`, `done_with_current_batch.bb`) via
`dispatch-lib/refuse-unexpected-args!`.

Argumentless invocation is unchanged: archive / stamp / chain as before.

## Operator / agent check

```bash
# Must refuse — parcel stays in in_process
done_with_current.sh --help

# Completes only with zero args
done_with_current.sh
```

Out of scope: `ready_for_next.sh`'s internal `--idle-boundary` contract.

Acceptance: `specs/features/BL-652-done-with-current-arg-rejection.feature`.
