# Human directive — Epic reprioritization screen in the Mini App console

**From:** human (via Claude Code coordinator session)
**Date:** 2026-07-23
**Authority:** human-requested, "prioritize next"

## Problem

Today, reordering an epic's priority means hand-editing `priority:` in its
`backlog/paused/BL-*.yaml` file and committing directly — there is no UI for it.
The human wants a screen in the live Mini App console where epic priority can be
reordered directly, rather than editing YAML by hand.

## Scope (confirmed with human, 2026-07-23)

- **Action:** reorder/set epic priority from the UI — a write path, not view-only.
  Writes back to the epic's own `priority:` field in its `backlog/paused/BL-*.yaml`
  on `main`.
- **Surface:** the **live holistic UI** (Mini App console), served by
  `bridge/bridgeServer.ts` / rendered via `extension/src/bridge/holisticUiHtml.ts`
  — token-authed, can perform control actions. NOT the static backlog-dashboard PWA
  (`pwa/index.html` -> `pwa/app.js`) — that surface is a read-only git-SHA
  projection with no write path and no bridge/host connectivity (see the project's
  "two phone-viewable surfaces" architecture rule).
- **Scope boundary:** epic-level reordering only (BL-539..BL-545, BL-552..BL-558,
  etc. — tickets with `type: epic`). Reordering a single epic's own child slices is
  a distinct, separate concern — do not fold it into this ticket unless the
  specifier judges it trivially in-scope.

## Open questions for the specifier to resolve in the spec

- Auth/permission model for a write action from the Mini App (token scope already
  established by the bridge server's existing auth — confirm it covers a
  backlog-mutating action, not just read/control actions like GH-23's dashboard).
- Concurrent-writer safety: this mutates `backlog/paused/*.yaml` on `main` from a
  live UI action while the coordinator/specifier/other roles may also be
  committing to `main` concurrently — needs the same commit-integrity discipline
  used elsewhere (`commit_integrity_cli.bb`), not a raw commit from the bridge
  server.
- Whether the reorder is a full priority renumbering (respecting existing
  priority values of untouched epics) or a simple drag-to-position UI that
  recomputes affected priorities — specifier's call, informed by how
  `active_backlog_max_depth`/promotion ordering actually reads `priority:`.

## Proposed epic

Specifier: drain this intake into a properly-scoped ticket (or small epic if it
naturally slices) in `backlog/paused/`, with a Gherkin feature under
`specs/features/`. `human_approval` still required before promotion — this
intake, on its own, is not itself an approval to promote.
