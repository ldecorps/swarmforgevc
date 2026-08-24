# Residual-word allowlist survives backlog stage moves (BL-694)

Grandfathered backlog tickets are allowlisted by **basename**, not by a full
`backlog/<stage>/...` path. Moving a ticket between `active` / `paused` /
`hold` does not require a test edit.

Logic: `extension/test/onboarderResidualAllowlist.js` →
`ALLOWED_BACKLOG_TICKET_BASENAMES` + `BACKLOG_STAGE_RE`
(`^backlog/(active|paused|hold)/`). Paths outside those stage dirs fall through
to the exact-path allowlist — a same basename under `backlog/topics/` is **not**
excused by basename alone.

## BL-752: the non-stage case is executed, not assumed

BL-694's Outline 04 now includes the "non-stage path under the backlog" row, so
the registered handler runs. Dedicated acceptance:
`docs/how-to/BL-752-residual-allowlist-non-stage-backlog-path-is-tested.md`.
