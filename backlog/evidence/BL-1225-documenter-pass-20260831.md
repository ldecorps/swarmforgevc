# BL-1225 — documenter pass, 2026-08-31

Received via coordinator's `merge_and_process` note (`28bf5c57f0`), which
routed the released ticket straight to documenter per the coder's no-op
evidence (`BL-1225-coder-noop-20260831.md`): the functional commit
(`0dfdaf91ed`, `runtime.log` append fix + `SWARMFORGE_DAEMON_START_CALLER`
attribution) and the cleaner/architect/hardener passes were all already
ancestors of this worktree's HEAD and `origin/main` before this pass began.

## Doc pass

- New how-to: `docs/how-to/BL-1225-sync-restart-trail.md` — the append-vs-
  truncate fix and the caller attribution, verified against the actual
  diff in `0dfdaf91ed` (`build_freshness_lib.bb`'s
  `operator-log-spawn-opts` and `daemon-start-caller`, wired from
  `restart-operator-group!` / `restart-handoffd-group!` in
  `build_freshness_cli.bb`). Cross-links the BL-1224 sibling doc
  (`BL-993-operator-runtime-watch.md`, "A deliberate restart by something
  else is adopted, never counted as a crash" section) — same intake, the
  other half.
- Linked from `docs/index.md` next to the BL-993 entry.
- `docs/reference/Specification.MD` "Last Updated" changelog gains a new
  top entry for BL-1225.
- No diagram update: BL-1225 changes neither a component/boundary nor the
  `.swarmforge/` state layout the architecture diagram depicts — it fixes
  how an existing log file is written and adds one env var to an existing
  restart call, no new state file or new topology.

Commit: `c681bcd05b` "BL-1225: document the sync-restart audit-trail
fixes."

## Disposition

Forwarding `git_handoff` to QA, priority `00`, task
`BL-1225-sync-initiated-restart-leaves-a-readable-trail`.

By documenter.
