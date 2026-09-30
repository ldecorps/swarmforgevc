# coder@iq3 reliability — specifier trace, 2026-09-30

Answers coordinator note 013961 ("Mint local-llm-swarm ticket: coder@iq3
reliability"), whose observations are in
`backlog/evidence/coder-iq3-reliability-20260930-coordinator.md`
(untracked, the coordinator's). The same afternoon the human said, in the
specifier pane: "Take over the in progress hotfix. Make it the swarm
absokute priority to make iq3 work."

## Sources read

- qwen's own session records:
  `~/.qwen/projects/-home-carillon-swarmforgevc--worktrees-coder-iq3/chats/`
  9f06a797 (12:13-12:26Z), 6119e423 (12:27-12:50Z), 992f20dc (12:51Z on).
- Per-request token usage: `~/.qwen/usage/token-usage-2026-09.jsonl`.
- The Ollama server log: `.swarmforge/ollama-serve-operator.log`.
- `~/.qwen/settings.json` (the ista entries only) and the worktree's
  `.qwen/settings.json`.

## Findings

1. **Why the seat crashed.** The crash at 12:26Z came from qwen's own
   budget: "Estimated prompt tokens: 32631; hard limit: 30852.8". That limit
   comes from `contextWindowSize: 32768` in the `ista-iq3s-coder:latest`
   entry of `~/.qwen/settings.json`. Ollama was already serving 49152, so
   the bump never reached qwen. The launcher only adds a missing entry and
   never updates an existing one; the full-forge launch never writes it.
   The turn that tipped it was ONE reply of 9,484 tokens (Ollama task 2974,
   about 8.5 min at 18.5 tokens/s). → BL-1838; the live entry was fixed by
   hand in 2cdb259806's pass.
2. **Why it was slow ("0% CPU").** The inference runs in the Ollama runner,
   not the seat's process tree. At num_ctx 49152 the f16 KV cache is
   3 GiB, which pushed 8 of 65 layers to the CPU. Generation fell from
   ~18.5 tokens/s (32768, 64/65 layers on the GPU) to ~3.5 tokens/s: one
   13-minute request was still generating when it was cut. → 7f38e5d7fe:
   a q8_0 KV cache with flash attention; 65/65 layers on the GPU,
   1632 MiB KV, 24.8 tokens/s measured after the restart.
3. **Why it made no progress.** Every session start read
   `swarmforge/constitution.prompt`, `PIPELINE.md` and `coder.prompt`
   before the ticket, because the loop card said "read ... before acting".
   Then it read the whole 574-line `prompt_engine_lib.bb`. With qwen's
   overhead at 12.2k tokens on the first request, the working room was gone
   before any code was written. → 2cdb259806 and 7f38e5d7fe
   (`local-model/loop.note`: no up-front reads, large files in parts, edits
   never whole-file rewrites). Session 992f20dc went from the card
   straight to the ticket.
4. **Two turns lost on every start.** qwen's "@" file-reference handling
   rewrote the launch prompt's `.../prompts/coder@iq3.md` to
   `.../prompts/coder @iq3.md`. It is visible in qwen's record of the first
   user message in all three sessions, and each session then got
   "File not found" and a glob. → BL-1837.
5. **Not what it looked like.** The seat did not re-run
   ready_for_next.sh: each session called it once and got the TASK. The
   repeated "You already have in_process work..." lines in the pane are
   handoffd's in-process resume nudges (`notify-in-process-resume!`), typed
   into a pane whose qwen runs non-interactively and never reads them. The
   pane-busy check (`chase-sweep-lib/actively-processing?`) recognises
   only Claude-style status frames, so a mid-turn qwen reads as idle.
   Harmless on this evidence; not ticketed. Ticket it if a nudge or a
   stuck-escalation is ever seen to disrupt a running local seat.
6. **Routing.** BL-1816 (prompt_engine_lib.bb, 574 lines) is at the edge of
   what this seat can hold. The operator's rule for this seat is simple
   tickets only.

## Actions this pass

- 2cdb259806: the operator's in-progress hotfix (start-swarm.sh env for a
  loopback key, the BL-1801 gate composing the stage prompt, qwen
  `--seat-tier` strip, the full-forge seat line, the Modelfile), plus the
  card rule.
- 7f38e5d7fe: q8_0 KV and flash attention by default in the swarm's
  Ollama start, `num_predict 4096`, and the edit-tool card rule.
- Live: `~/.qwen/settings.json` ista entry 32768 → 49152 (backup in the
  specifier's scratchpad); Ollama restarted with the same
  OLLAMA_MODELS/OLLAMA_CONTEXT_LENGTH plus the two vars; the coder@iq3
  card recomposed and its dead pane respawned with its own start command.
- Minted BL-1838 (high, priority 0) and BL-1837 (medium, priority 1),
  both queue-jump in epic local-llm-swarm.
