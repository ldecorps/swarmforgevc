# BL-1132 — cleaner rematch #2 — 20260825

- **QA bounce D1 (blame: cleaner):** merge `867f830dc` re-dirtied tip-pure
  coder rematch `bca6102de` (`dels_on_origin=15`, multi-ticket hitchhike).
- **Remediation:** `reset --hard origin/main`, ff-merge **only** `bca6102de6`,
  record rematch bounce evidence.
- **Purity:** `dels_on_origin=0`; BL-1132 paths only (+ bounce/cleaner evidence).

By cleaner.
