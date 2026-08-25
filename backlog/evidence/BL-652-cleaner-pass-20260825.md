# BL-652 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `206381f7e9` only
  (`dels_on_origin=0`).
- `refuse-unexpected-args!` is the single fail-fast gate; wrappers call it
  before any mailbox mutation.
- `test_done_with_current_arg_rejection.sh` ALL PASS.

By cleaner.
