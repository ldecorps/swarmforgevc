# Specifier outage RESOLVED — root cause: stale mono-router marker — 2026-09-02 18:01 UTC

## Trigger
Babysitter: `swarmforge-specifier: tmux session missing` (plus the known
30-min Article 4.2 re-fire for `e358e1b46e`/`b71c941a19` — no action, see
[[coordinator-babysitter-art42-no-ack-mechanism-repeats-20260902]]).

## Swarm state at check (18:00:55 UTC) — via ps/pgrep, then tmux
- All 7 role sessions alive (created 16:34). `handoffd` pid 12000 and
  `handoffd_supervisor` pid 12064 alive. **No collapse** (BL-107 cleanup
  did not fire — the duplicate was TERMed, not exited by itself, and it was
  not the cleanup owner).
- Duplicate coordinator (pid 11834, formerly in the specifier pane): gone.
  Exactly one `launch/coordinator.sh` remains (22937, this session).
- **Real specifier running**: `swarmforge-specifier` re-created 18:00:32 UTC,
  pane runs `zsh launch/specifier.sh` (10771) → `claude … --append-system-prompt-file
  prompts/specifier.md --remote-control SwarmForge-Specifier` (10815).
- "Session missing" was the ~20 s window between kill and re-create.
- Specifier inbox already draining: it claimed my BL-848 root-intake note
  (`003448`) into `in_process`; 4 remain in `new/` (hardender, coder
  BL-1317 spec-gap, QA, and my babysitter-ack-gap note `003449`).

## How it was fixed (from the operator shell still visible in `ps`, pid 2099)
The human, from another Claude Code session, ran in order:
1. `mv .swarmforge/mono-router-active-role .swarmforge/mono-router-active-role.stale-20260902T1107`
2. `kill -TERM 11843` ("duplicate coordinator (pid 11843, specifier pane) sent TERM")
3. waited up to 60 s for handoffd `chase-respawn specifier` — **it never
   logged one** (grep of `handoffd.log` finds no respawn line), then
4. re-created the session by hand:
   `tmux -S .swarmforge/tmux/1523266553.sock new-session -d -s swarmforge-specifier … zsh launch/specifier.sh`
   (pid 22790).

## Root cause (verified, not inferred)
`.swarmforge/mono-router-active-role` contained the single word
`coordinator` (file mtime 11:07 today). That marker is the mono-router
pack's "current resident role" flag (`config rotation router` packs:
`anthropic-mono-router.conf`, `qwen-anthropic-mono-router.conf`, …). The
pack actually running today is a STANDING pack (every role its own pane),
but the marker outlived whatever router session wrote it at 11:07, and the
launcher/respawn path kept honouring it — staffing the specifier's pane
(the router seat) with the marker's role. That is why BOTH relaunches
today (13:18 and 16:34) produced a duplicate coordinator and zero
specifiers, and why it "recurred": nothing cleared the marker between
launches. Moving it aside is what made the 18:00 relaunch staff correctly.

Two secondary findings, still open:
- handoffd's chase-respawn did not re-staff the missing specifier within
  60 s — the human had to hand-launch. Worth checking whether respawn is
  gated on the same stale marker or simply slow.
- `.swarmforge/bounce` sentinel (re-armed 17:34 UTC) is still unconsumed;
  `bounce-ack.json` last written 2026-08-22. The sanctioned bounce path has
  no listener. Unchanged from
  [[coordinator-specifier-outage-recurred-blocking-hotfix-stamp-20260902-1733]].

## Minimal correct action taken
- No process/tmux action by me (BL-107 discipline) — none needed now.
- Sent the live specifier a `note` (priority `10`) to ticket the launcher
  defect: a stale `mono-router-active-role` marker on a non-router pack
  must be ignored/cleared at launch (and respawn), never used to staff a
  pane. Includes the two secondary findings as scope candidates.
- Memory updated with the root cause and the exact recovery recipe.
- `pipeline_stage_cli.bb sync` re-run after this queue sweep.

By coordinator.
