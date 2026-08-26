# GH-25 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `c798ead59f` only
  (`dels_on_origin=0`).
- Dropped babashka noop sentinel in `role_ask_escalation_lib.bb`;
  unused `err`/`out` from `gh issue comment` sh result.
- Lib + GH-25 runners green.

By cleaner.
