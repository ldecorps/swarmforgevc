# BL-1801 — architect review pass, 2026-09-30

1 defect found. One bounce, complete inventory (Article 4.4).

## D1

- **Failing command**: A live measurement of qwen 0.22.2's real CLI
  overhead on this host, using the exact method the ticket's own
  description names ("Point the CLI at a fake OpenAI-compatible endpoint
  that logs the first request body, and count the characters it adds
  beyond the prompt file"):
  ```
  node fake-endpoint.js &   # logs the captured request body to disk
  OPENAI_API_BASE=http://127.0.0.1:38123 OPENAI_BASE_URL=http://127.0.0.1:38123 \
    OPENAI_API_KEY=sk-fake qwen --auth-type openai -y -m test -p "<51-char marker>"
  ```
- **Commit hash**: 16c9ed4753 (the parcel received at architect)
- **First error excerpt**: The captured request body's `messages` (system
  prompt 28,259 chars + three qwen-injected system-reminder blocks
  totalling ~34,303 chars for the "user" turn) plus `tools` (the default
  tool-schema array, 64,324 chars) sum to roughly 98,576 characters of
  overhead beyond the 51-char marker prompt — not the
  `DEFAULT_LOCAL_MODEL_CLI_OVERHEAD_CHARS=3000` the parcel ships. Verified
  this is not test contamination: `~/.qwen/settings.json` on this host
  already carries the swarm's own `modelProviders.openai` entries for
  local Ollama models, and `~/.qwen/skills/`, `~/.qwen/memories/` exist —
  the skills-list and per-project-memory system-reminders the fake
  endpoint captured are qwen's own real non-interactive startup behavior
  on a real swarm host, not an artifact of my test harness. The real
  launch (`swarmforge.sh:2191`) invokes qwen the same way
  (`qwen --auth-type openai -y ... "<instruction>"`, no `--tools`
  restriction for a `local-model` seat), so this capture is representative.
- **Failure class**: behavior
- **Expected vs observed**: qa_e2e item 2 requires "the evidence records
  the measured qwen CLI overhead ... and the constant in the lib equals
  it" — a REAL measurement, not a placeholder. Expected: a constant that
  reflects qwen's actual overhead so the gate can do its one job (never
  launch past the served window). Observed: `DEFAULT_LOCAL_MODEL_CLI_OVERHEAD_CHARS=3000`
  is ~30x too low. Concretely, at the real overhead, `ista-iq3s-coder:latest`
  (num_ctx 32768, confirmed live via `/api/show`) already exceeds its
  window from CLI overhead ALONE, before BL-1798's composed card is even
  added — `bb local_model_window_gate_cli.bb check ... --overhead-chars 98576`
  correctly REFUSES (32876 tokens > 32768); the same call with the
  shipped `--overhead-chars 3000` silently PROCEEDS. The decision logic
  itself is correct (verified independently); the constant it is fed is
  the defect, and it is exactly the load-bearing number this ticket exists
  to get right — a placeholder 30x too low means the gate will not refuse
  the very launches it was built to catch, defeating the ticket's own
  stated purpose ("a local-model seat never launches past its served
  window").
- **Blamed role**: coder
- **Remediation pointer**: Re-measure `DEFAULT_LOCAL_MODEL_CLI_OVERHEAD_CHARS`
  using the fake-endpoint method above (this environment's egress reached
  the loopback fake server fine — no external network was needed, only a
  local HTTP listener; the prior sandbox's blocker is not present here).
  Update the constant in `swarmforge.sh` to the real measured value (or
  the nearest safe round number above it), update the evidence file's
  measurement section from "documented estimate" to a completed capture
  (CLI version, exact command, captured character counts), and re-run the
  acceptance suite (its scenarios inject their own fixed 3000 directly, so
  they are unaffected either way — only the shipped constant changes).
  Consider flagging to the specifier, as a separate note, whether a
  `local-model` seat should launch qwen with its own skills/memory system
  disabled (a design question outside this ticket's own scope, not a
  reason to hold this fix).

By architect.
