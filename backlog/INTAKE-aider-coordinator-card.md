# Intake: a compact coordinator card for local aider seats, and the command relay it needs

Filed 2026-09-23 by Claude Code at the human's direction, on the operator seat.
A RAW ask, not a spec: the specifier drains it like any backlog-root item and
decides what becomes a ticket.

## The ask

Human, 2026-09-23 (verbatim, in order): "is the coordinator prompt ridiculously
too long? it's not a seat that has a complicated task to do has it?" - "how do
we compact the coordinator's prompt for the aider coordinator? I suppose that's
one job for the prompt factory" - "draft the coordinator's card but let the
swarm know about it". The human reviews the card before it goes live.

## What already exists (inert)

`swarmforge/roles/aider/coordinator.prompt`: a draft card, 898 tokens against
the full `coordinator.prompt`'s 15,662. Nothing loads it: `context-files`
(agent_runtime_lib.bb:61) still hands every aider seat the full role prompt, and
`standing_rule_violations_files.bb` lists `roles/` non-recursively. It is a
decision table (situation -> one command) drawn from the full prompt's own
procedures (QA-approval bookkeeping steps 0-4, open-slot promote+route, the
handoff draft, role_ask, idle) and the scripts' own usage lines. It does not
restate the promotion gates: promote_and_route_next.sh enforces them and says
why it refuses.

## Why (measured, backlog/evidence/aider-seat-context-budget-20260923.md)

- The coordinator's first request is 20,381 tokens; at the 8,192 served until
  today Ollama dropped its role prompt every turn, silently.
- At 32k (d0dd4d36b7) it fits, but one cold coordinator turn took 8+ minutes on
  this CPU and held the only inference slot while the coder queued behind it.
- With the card as a read-only file, aider's own /tokens counts 3,656 tokens,
  2,302 of them the repo map (aider doubles the map when no file is editable).
  `--map-tokens 0` for the coordinator would leave about 1.4k.

## Verified mechanics the ticket must build on

1. aider never runs a line starting with `!` from the MODEL's reply; `!` is REPL
   input. Only commands handoffd types into the pane ever run.
2. aider parses model shell commands only from fenced ```bash blocks, only in
   diff/editblock format (`editblock_coder.py`; `wholefile_coder.py` has none).
3. Under `--yes-always` aider AUTO-DECLINES them: shell prompts are
   `explicit_yes_required=True` (base_coder.handle_shell_commands), and
   `io.py:867` answers "n" in that case. So headless aider has no model-driven
   execution at all, whatever the prompt says. `--dry-run` gates edits only.
4. `context-files` loads role files with `/add` (editable), and the bootstrap
   text names `ready_for_next.sh` and `handoff-draft.txt`, which aider auto-adds
   as editable too.

## Proposed scope (for the specifier to shape)

a. PromptEngine wiring: aider seats load `roles/aider/<role>.prompt` when it
   exists, else the full prompt; via `/read-only`, not `/add`; no constitution
   index for aider seats (it claims articles are "inlined right after", false
   there); the bootstrap text stops naming pipeline scripts. Claude seats keep
   the full prompt, unchanged.
b. The aider coordinator's launch: `--edit-format diff` (aider's own system
   prompt then teaches the same fenced-block convention the card uses) and
   `--map-tokens 0`.
c. A command relay (fact 3 makes it necessary): read each `LLM RESPONSE` in
   `.swarmforge/aider-llm-history/coordinator.log` (exact model output, no pane
   scraping, since ab1d4cb2bd), extract the single fenced bash block, match it
   against an allow-list derived FROM THE CARD (each row's command shape with
   its placeholders), and run a match as `/run <cmd>` in the coordinator pane:
   aider adds the output to the chat (that prompt is not explicit-yes). No
   match: never run; log it and tell the seat "not run: not in the card". A
   `/run` must not get the aider no-narration suffix notify-agent! appends to
   injected text today.
d. Fast deterministic tests: a coverage manifest (every `##` section of the
   full prompt marked card / enforced-by-script <name> / claude-only <reason>;
   fails on an unmarked new section, so incident rules cannot silently bypass
   the card); a budget test (coordinator first request under 25% of the served
   window); a channel test (every command in the card exists; no `!`-line
   instruction; the allow-list accepts every card row and rejects near misses:
   an extra `; cmd` or `&& cmd`, command substitution, `git commit`,
   `rotate_to_role.sh`).
e. Before live: replay the captured coordinator request with the card swapped
   in, against qwen2.5-coder at temperature 0, for three fixed situations (idle,
   QA approval, open-slot note). Pass = exactly one fenced block whose command
   matches the expected row. Record the latency against today's 8+ minutes.
f. Then a canary on the live router.

## Open questions for the specifier

1. Does the relay belong in handoffd (it owns pane injection today) or in the
   seat's launch wrapper?
2. Should `rule-source-files` scan `roles/aider/`?
3. The card leaves out tracer bullets, ambulance mode, QA holds, land-approval
   records and bounce requests: acceptable as claude-only in the manifest, or
   which must join the card?
4. Row 1a keeps the full prompt's one git command
   (`git fetch origin main && git merge --ff-only origin/main`). Keep it on the
   allow-list, or leave that join to handoffd's master-main reconcile?

## Firm

- The card stays inert until the wiring ticket lands; the human reviews it first.
- The relay never runs anything off the allow-list; nothing here auto-accepts
  arbitrary shell for any seat.
- Claude seats are untouched.
