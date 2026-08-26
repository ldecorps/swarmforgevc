# BL-1078-a-cursor-agent-token-is-accepted-by-the-launcher — documenter pass — 20260823

Commit reviewed: `e9b6d334b4` (hardener's forward, `merge_and_process hardender
e9b6d334b4`).

## What changed

`cursor` became a first-class agent token: `swarmforge.sh`'s
`validate_agent` allow-list, `check_backend_dependencies` (checks the real
`cursor-agent` binary, not the token), and a new `cursor)` case in the
launch-command builder (`cursor-agent --force --trust --workspace <worktree>
...`, `--add-dir` for a non-root worktree — same terminal-native shape as
`vibe`/`gemini`/`grok`). `prompt_engine_lib.bb`'s `provider-capabilities`
table gained a `"cursor"` entry (`:chat-message`/`:embedded`, no `:acp` — it
is terminal-native, matching BL-1081's reasoning for the same CLI). A new
admission guard, `swarmforge/scripts/cursor_seat_guard.bb` /
`cursor_seat_guard_lib.bb`, runs before any window opens
(`check_cursor_seat_admission`, wired into the launch sequence ahead of
`prepare_workspace`): an uncertified Cursor identity (Model Steward registry
status not `"certified"`) is refused unless
`SWARMFORGE_CURSOR_SEAT_SPIKE=1` is set — the same escape env var and value
BL-713's `cursorIdentity.ts` already declares, verified to agree by
`cursor_seat_guard_lib_test_runner.bb` driving the real TS side (BL-897: a
"kept in sync" comment is not a gate). Certification itself (BL-1079) and
pack-line usage/how-tos for this launcher path (BL-1080) are explicitly out
of this ticket's scope per its own description.

## Doc surfaces checked

- Grepped `docs/` for the launcher's old agent allow-list literal
  (`claude|codex|copilot|grok|aider|vibe|gemini`): one hit,
  `docs/how-to/BL-713-cursor-seat-driver-spike.md`, which is the spike CLI's
  own how-to and is now factually wrong in two places this ticket touches:
  - Its `--agent <token>` flag row said "the `cursor` launcher token itself
    doesn't exist yet (BL-712 slice B)" — it now exists. Corrected, and
    pointed at the boundary section rather than re-explaining.
  - Its "Boundary: what this slice is not" section said flatly "Not the
    launcher. `./swarm` still only knows the existing agent tokens...;
    adding `cursor` there is BL-712 slice B." Rewrote that bullet to state
    the launcher path now exists as a **separate** path from the spike CLI
    (different entry point, same mirrored admission rule/escape var), so a
    reader doesn't conflate `cursor-seat-spike.js` with the new `./swarm`
    `cursor` token — and does not read a false "not built yet" claim.
    Cross-referenced BL-1078/BL-1079/BL-1080 by ticket id rather than
    duplicating their scope.
  - `docs/index.md`'s summary line for that how-to said "the boundary
    against BL-712's still-to-come launcher token" — updated to "now-landed
    ... launcher token (BL-1078) and still-to-come steward certification
    (BL-1079)".
- `docs/reference/BL-1081-acp-hosted-seat-snapshot.md` (written by the
  documenter's own prior pass this session, before BL-1078 landed on this
  branch) stated "Cursor is deliberately absent from this table" about
  `prompt_engine_lib.bb`'s provider-capabilities table — no longer true now
  that BL-1078 added a `"cursor"` entry to the same table. Corrected to
  describe the entry (unmarked, i.e. not `:acp`) and cross-linked to
  BL-713's how-to for the seat itself, rather than leaving a doc this
  session itself wrote already stale.
- Grepped `docs/` for `BL-712`, `BL-1078`, `cursor-agent`, `CURSOR_API_KEY`:
  remaining hits are unrelated (Cursor **Bridge** — the Telegram-to-Cursor-
  IDE bridge, a different feature; `Specification.MD`'s rolling changelog
  entries, which are dated historical log lines, not live claims, and are
  never rewritten after the fact).
- `docs/diagrams/architecture.mmd` / `swarm-flow.mmd` — grepped for agent
  token names (`vibe`, `gemini`, `grok`, `codex`, `claude`, `copilot`):
  neither diagram names individual agent tokens at all (they're scoped to
  extension host/webview/substrate/`.swarmforge` state at a coarser
  granularity than "which CLIs a pack window can name"). No diagram change
  needed — adding a launcher-accepted agent token doesn't change a
  component or a channel either diagram depicts.
- README.md: no new extension command, setting, or webview-visible flow —
  this is a `./swarm` pack-launcher change (SwarmForge's own launcher, not
  the VS Code extension's command surface). No README change needed.
- No new how-to written for the launcher path itself: the ticket's own
  description states "Not in this slice: ... pack lines and how-tos
  (BL-1080)" — writing one now would be scope the ticket explicitly defers,
  and Divio classification is for placing what a parcel needs, not filling
  a mode preemptively.

## Forward

Forwarding the received commit unchanged to QA, priority 00.

By documenter.
