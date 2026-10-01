# coder@iq3 (local qwen, secondary coder seat) reliability — 2026-09-30, coordinator observation

## What was observed, live, on BL-1816

- Session ran ~11 minutes working BL-1816, then crashed:
  `[API Error: Context is too large to send safely after automatic
  compression. Estimated prompt tokens: 32631; hard limit: 30852.8;
  compression status: COMPRESSION_FAILED_INFLATED_TOKEN_COUNT. Start a new
  session or reduce the resumed history before continuing.]` — this was
  under the seat's *old* 32768 num_ctx (the reload to the new value hadn't
  happened yet because the session never went idle long enough for Ollama's
  keep-alive to expire and re-serve the updated model).
- The pane's local respawn wrapper auto-restarted the crashed qwen process
  (new pid, no daemon chase/nudge involved — `handoffd.log` shows no
  chase-respawn entry for coder@iq3 around this time, and the BL-1816
  in_process claim's `nudgeCount` stayed 0, `reclaims` stayed 0).
- Coordinator bumped `num_ctx` 32768 -> 49152 as a stopgap
  (`swarmforge/packs/ista-iq3s-coder.Modelfile`, `ollama create`) — confirmed
  live via `ollama ps` showing `CONTEXT 49152` after the respawn picked up
  the new manifest.
- The **fresh** session (post-respawn, post-resize) then printed the
  RESUME-ON-START notice and called `ready_for_next.sh` **repeatedly** (3
  times observed over ~10 minutes) despite each response explicitly saying
  "You already have in_process work. Continue the current TASK; do not run
  ready_for_next.sh again." Between calls, CPU on the whole process tree sat
  near 0% (0.0-0.2%). `git status` in the coder-iq3 worktree stayed clean —
  zero commits, zero diff, on BL-1816 for the whole observed window.

## What this looks like

Not obviously a window-size problem post-resize (49152 has comfortable
headroom for a single turn: card 3,235 chars + qwen CLI overhead ~55,000
chars ≈ 19.4k estimated tokens, well under half the new window). Looks more
like either:
- a resume-flow defect specific to local-model seats (the RESUME-ON-START
  instruction isn't landing as "run it ONCE then stop", and the seat keeps
  re-triggering it), or
- a capability gap in a 27B IQ3_S-quantized model following multi-step
  instruction text (it may not be parsing "you already have work, don't
  re-run this" as an instruction to stop), or
- the mid-session compaction/crash itself left something in a state that
  confuses the resumed session about what to do next.

## Why this matters

Operator directive (2026-09-30, this chat): coder@iq3 is meant to be a
viable secondary coder seat for simple tickets, watched closely. Right now
it burned ~20 minutes on BL-1816 with zero forward progress and a crash.
Scoping and root-causing this (window/compaction tuning vs. resume-flow
defect vs. prompt-following gap) is needed before routing more work to it.
