# BL-1127 — cleaner rematch — 20260825

- **QA bounce D1 (blame: cleaner):** tip `c66b4ce99` / merge `fa0d3c78d`
  re-dirtied tip-pure coder tip `15af12d36` (`dels_on_origin=15`).
- **Remediation:** `reset --hard origin/main`, ff-merge **only** `15af12d36`,
  record QA bounce evidence. Did not re-apply prior hitchhiking cleaner
  refactor tip.
- **Purity:** `dels_on_origin=0`; BL-1127 paths only (+ bounce/cleaner evidence).

By cleaner.
