# BL-1135 — cleaner rematch #2 — 20260825

- **QA bounce D1 (blame: cleaner):** tip `399aeb184` / merge `d7e02299f`
  re-dirtied tip-pure coder rematch `dd7be8260` (`dels_on_origin=15`).
- **Remediation:** `reset --hard origin/main`, ff-merge **only** `dd7be8260`,
  record rematch bounce evidence.
- **Purity:** `dels_on_origin=0`; BL-1135 paths only (+ bounce evidence).

By cleaner.
