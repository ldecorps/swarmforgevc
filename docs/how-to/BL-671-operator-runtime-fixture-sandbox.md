# How operator_runtime test fixtures sandbox their load-file deps (BL-671)

`operator_runtime.bb` `load-file`s many sibling libs. Fixtures that copy only
a hand-maintained subset break at require time when a new lib is added.

## Fix

All `test_operator_runtime_*.sh` fixtures call:

```bash
source .../lib/operator_runtime_sandbox.sh
copy_operator_runtime_sandbox "$SRC" "$dest/swarmforge/scripts"
```

`OPERATOR_RUNTIME_SANDBOX_LIBS` (the array inside that helper) is the single
place to update when `operator_runtime.bb` gains a new `load-file`.

## Acceptance

`specs/features/BL-671-operator-runtime-fixtures-miss-cost-ledger-lib.feature`
