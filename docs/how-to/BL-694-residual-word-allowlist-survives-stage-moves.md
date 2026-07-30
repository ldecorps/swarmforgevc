# Residual-word allowlist survives backlog stage moves (BL-694)

Grandfathered backlog tickets are allowlisted by **basename**, not by a full
`backlog/<stage>/...` path. Moving a ticket between `active` / `paused` /
`hold` does not require a test edit.

Logic: `extension/test/onboarderResidualAllowlist.js` →
`ALLOWED_BACKLOG_TICKET_BASENAMES` + `BACKLOG_STAGE_RE`.
