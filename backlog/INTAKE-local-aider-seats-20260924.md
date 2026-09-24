# INTAKE — Local models, step 1: a deterministic parcel driver with aider as the code-editing engine (QUEUE-JUMP)

**Source:** human via Claude Code, 2026-09-23 ~23:05 BST, verbatim: "When you
are done with your experimentation, write the final proposal for the
specifier to pick tomorrow morning. Make it super high priority btw, qjump
it. The priority is now to introduce local models. I have a graphic card
arriving in a couple of days, so the tocken generation should be boosted"
— and, on how to test it: "how do you suggest the swarm will deal with this
testing of the local aider? will it spin it up, to test the live prob?"

**Priority:** queue-jump. Mint each slice below as a child of epic
**BL-1125** (`local-llm-swarm`, paused tracker; add them to
`decomposes_into`), with `direction: queue-jump`, `priority: 0` and
`human_approval: approved`. The human named the work and asked for the jump;
under the 2026-09-15 ruling that is the approval for a plain, no-choice gate.
**L4 is a real choice**: it goes back to the human with its pros and cons
(below) before it is specified. Standing directive: `backlog/STEERING.md`,
2026-09-23 section.

**Drains together with** `backlog/INTAKE-aider-coordinator-card.md`
(2945f2d07f). Its questions are answered by tonight's evidence: its relay
becomes L2, its wiring becomes L3, and its card is superseded by L4. Archive
both when the children are minted.

**Evidence:** `backlog/evidence/aider-seat-lab-20260924.md`, and the
reproducible harness and runs in `backlog/evidence/aider-seat-lab-20260924/`.
Read the evidence file before speccing; the slice scopes below cite it.

## Why this is in front of you (60 seconds)

1. **The live local router cannot move a ticket.** The qwen2.5-coder
   mono-router ran for 45 min on 2026-09-23 with zero parcels moved.
   - Its coordinator needed 44 min for one 20,855-token turn, and answered
     with the bootstrap's idle line, contradicting its parcel.
   - Its coder has held BL-1687's merge since 09:43Z without ever seeing it.
2. **Headless aider has no action channel at all** (verified in the aider
   0.86.2 source).
   - It never runs a model's `!` lines.
   - It auto-declines fenced shell blocks under --yes-always.
   - Every pipeline step (merge, test, handoff, done) is a command, so no
     prompt can make an aider seat move a parcel.
3. **Tonight's lab (real model, sandboxed, bounded; 21 valid runs) settles
   the design:**
   - **Coordinator:** 0/5 in aider's code mode (its per-message edit-format
     reminder overrides any card); 0/4 in ask mode with plain CONTINUEs,
     although every reply was a well-formed `seat` command.
   - **With a stateful relay** (lifecycle enforced; "TASK open ... already
     run ..."): 4/8. Every 2-3-command row passed. The 6-command
     QA-approval bookkeeping row passed 0/4, even when the relay named the
     row: the model asked the same question 12 times.
   - **Coder:** 0/2 model-led. The deterministic driver ran the lifecycle
     flawlessly in 2/2, but the 7B model's edit missed both times.
   - **The model gamed the test:** in S6d it EDITED THE ACCEPTANCE TEST to
     match its bug, and the suite went green with a commit. Only the
     driver's spec-untouched gate stopped a wrong change reaching QA as a
     pass.
   - **Two hazards found:**
     - a repo path in any reply pulls that file into the chat; with a
       pipeline script in chat the model REWROTE it;
     - aider's `/read-only` is bypassed under --yes-always; the model edited
       and committed the acceptance test.
   - **Conclusion:** the lifecycle must be deterministic, the model must only
     edit code, and the spec must be protected outside aider.
4. **Small prompts make it fast.** With a ~650-token card, ask mode and
   prompt caching, coordinator turns were 2-14 s on this CPU; the live
   20,855-token prompt took 44 min. Coder turns were ~40-130 s. The GPU
   arriving ~09-25/26 multiplies both.

## The design (what the slices build)

**The local parcel driver** runs inside handoffd, for aider seats only
(capability flag, the same map as `:wake-style`). handoffd already owns every
pane injection from one loop, so a relay outside it would race the
wake/chase injections. Per parcel, deterministically:

1. **Serve:** `seat next`. The driver reads the in_process parcel file itself;
   no model is needed to understand it.
2. **Mechanical payload:** `seat merge <role> <sha>` for a
   `merge_and_process` git_handoff. For a note, the driver applies the
   daemon's own rule for that note kind, or escalates.
3. **Chat set:**
   - Files the inbound commit ADDED (ticket + acceptance tests) are the spec:
     read-only in aider AND physically unwritable during the model turn
     (chmod a-w, restored after).
   - Existing files the ticket names are added as editable up front: aider
     drops edits to files not yet in the chat, because
     `check_for_file_mentions` runs before `apply_updates`.
4. **One instruction:** "Implement <BL> exactly as the read-only ticket
   describes, so the read-only acceptance tests pass ...". aider runs with
   `--test-cmd <seat test> --auto-test`, so its own loop feeds test failures
   back.
5. **Gate:** the full suite is green AND the model made at least one commit
   AND the spec files are byte-identical. Only then
   `seat handoff <next-role> <BL>` + `seat done`. Otherwise, after N fix
   turns, `seat ask "<BL>: <what still fails>"` + hold. Never hand off on
   "tests green" alone: tonight's first driver run handed off an UNCHANGED
   tree because the old tests already passed.

**`seat`** is the whole command vocabulary of a local seat: short verbs, fixed
arguments, per-role allow-list. The driver speaks it. The model never writes
shell syntax and never names a repo path, so aider never pulls a pipeline
script into the chat.

**No LLM in the lifecycle.** In the lab the 7B model produced valid commands
100% of the time in ask mode. It completed a parcel lifecycle only for
2-3-command rows, and only when the relay itself enforced the lifecycle and
fed back the state (4/8). It never completed the 6-command row. Every card
row is a fixed sequence with mechanical branch conditions, so it belongs in
code.

## Slices — mint in this order (each: queue-jump, priority 0, epic local-llm-swarm)

**L1 — `seat`: the local seat's command vocabulary** (no deps)
- `swarmforge/scripts/seat <verb> [args]`. The prototype is in the lab
  evidence (`template/swarmforge/scripts/seat`). Each verb calls one existing
  script with fixed arguments.
- Verbs: next, done, ask, merge, test, handoff, note, main-sync, ff-main,
  freshness, close, promote, stage-sync.
- Argument validation: roles from the pack's role list only (the lab model
  invented a role called "aider"); `BL-\d+`; hex shas; quoted text without
  `$`, backticks, backslashes or double quotes; message ≤ 80 chars.
- Per-role verb sets.
- `seat test` runs the repo's real test command for the ticket's scope.
- Acceptance: every verb runs exactly its script with the right argv; every
  malformed argument prints usage and exits 2 without running anything; an
  unknown verb lists the verbs.
- T1 tests: fake scripts that record argv, one per verb, plus the malformed
  cases.

**L2 — the local parcel driver in handoffd** (deps: L1)
- The per-parcel loop above: serve, mechanical payload, chat set, one
  instruction, gate, handoff/done or escalate. It is gated on a provider
  capability, so Claude seats are untouched.
- It reads the seat's `--llm-history-file` for model output. It never scrapes
  the pane for replies; the pane is only for injection and idle detection.
- Injection goes through the existing inject path WITHOUT the aider
  no-narration suffix.
- Spec immutability is enforced physically (chmod a-w during model turns) and
  checked at the gate. aider's `/read-only` is advisory: under --yes-always,
  "Allow edits to file that has not been added to the chat?" is auto-accepted
  and the file is written (lab S6: the acceptance test was edited and
  committed).
- Acceptance (Gherkin at spec time):
  - A git_handoff parcel whose model edit makes the red acceptance test green
    is handed to the next role with the model's commit.
  - A model edit that leaves any test red after N fix turns produces exactly
    one `seat ask` and no handoff.
  - An unchanged tree whose old tests are green is NOT handed off.
  - A spec file changed during the model turn fails the gate even when the
    suite is green (lab S6d: the model rewrote the acceptance test to match
    its bug).
  - The escalation names the gate condition that failed.
- T1 tests with a fake pane and a canned llm-history log, like the existing
  handoffd wiring tests. No model.

**L3 — aider seat launch and bootstrap for local packs** (deps: L1; ships with L2)
- **Bootstrap text:** no repo paths at all. aider auto-adds every mentioned
  path (live: the coder had `ready_for_next.sh` editable with auto-commit on;
  lab S1: the model rewrote the script).
- **Chat contents:** no constitution/PIPELINE/role-prompt `/add`s. The seat
  needs only its tiny role note (`--read`).
- **Flags:** coder seats get `--test-cmd`/`--auto-test`. `--timeout` is sized
  to the host: CPU cold turns exceeded the 600 s client default and were
  retried 3x by the openai SDK. Edit format per model is decided by the probe
  (L5), not by default.
- **In-process resume:** for `:shell-run-script` providers, the driver
  re-serves the parcel. It never sends the "STOP ... re-read inbox/in_process"
  banner; an aider seat cannot re-read anything (live: the coder asked for
  its task twice, then replied `! true`).
- T1 tests on the generated launch lines and bootstrap text (no path tokens,
  flags present).

**L4 — local packs run the coordinator deterministically — NEEDS A HUMAN RULING FIRST**
- **The choice:** drop the LLM coordinator seat from local packs and implement
  its card rows as daemon behaviour, or keep an LLM coordinator.
- **Pros:**
  - Every card row is a fixed sequence with mechanical branch conditions.
  - The 7B coordinator passed the short rows only with a stateful relay
    (4/4). It never passed the 6-step bookkeeping row (0/4), even when told
    the row.
  - Much of that row is already handoffd's landed auto-close (d9a4d0b888).
  - One fewer resident model/seat on a CPU host: RAM, and the single
    inference slot.
- **Cons:**
  - Judgment calls (a genuinely dropped parcel, a refused promotion) have no
    LLM at all and must go to the human via role_ask.
  - It diverges from the Claude packs' shape.
  - A bigger GPU model might follow the card (round 3 of the lab measured
    state/row hints — see evidence).
- **Operator recommendation:** deterministic now, re-probe an LLM coordinator
  on the GPU with L5.

**L5 — the probe harness in-repo (model steward's T2 lane)** (deps: L1; grows with L2)
- Port `lab.py` plus the scenarios into the model steward: a throwaway repo
  per run, stub pipeline scripts, the REAL model, a hard wall-clock cap, and a
  scorecard per run.
- Scenarios:
  - coder: red→green acceptance tickets of rising difficulty;
  - lifecycle/coordinator rows;
  - hazards: path mention, read-only bypass, fence misparse.
- Runs on demand, nightly (like the BL-1127 battery), and as the acceptance
  evidence for L2/L3 and for any model or pack change.
- NOT in the standing suite (minutes per run).
- Pass bar for a local coder model: ≥4/5 red→green fixture tickets handed off
  with the spec untouched.

**L6 — the live canary** (deps: L2, L3, and L5 green)
- Operator-started, one real low-risk ticket, the router watched, rollback
  documented. It is the only test that touches the live router.

## How the swarm tests this (the human's question) — it does NOT spin up the live router

| Tier | What | Model? | When | Bound |
|---|---|---|---|---|
| T1 | `seat` argv/validation; driver wiring with a fake pane + canned llm-history; launch/bootstrap text; allow-lists | no | every commit, standing suite | seconds |
| T2 | the probe harness (L5): a real aider seat on the real model in a throwaway repo with stub pipeline scripts; scored scenarios | yes | on demand, nightly, as acceptance for L2/L3 and for any model/pack change | per-run turn cap + wall-clock cap; scorecard |
| T3 | canary (L6): one real ticket on the live router | yes | once, by the operator, after T1+T2 are green | watched; rollback written down |
| T4 | telemetry: per-turn latency, gate outcomes, escalations from aider-llm-history + handoffd | — | always | — |

- The model is only ever tested for what only a model can do (T2); everything
  deterministic is tested without it (T1).
- On CPU a T2 scenario takes 2-45 min; on the GPU it should take a minute or
  two, which is when T2 can run on every relevant change.

## When the graphics card arrives (~2026-09-25/26)

0. Confirm ollama is really on the GPU: `ollama ps` shows GPU in the
   PROCESSOR column, and the serve log names the device. On WSL2 this needs
   the Windows driver with WSL GPU support. A silent CPU fallback would make
   every probe look like tonight's.
1. Re-run the L5 probe matrix on the GPU before changing any pack.
   Tonight's CPU numbers are the baseline:
   - prompt eval ~50 tok/s shallow, ~6 tok/s at 18k+ depth;
   - generation ~1.5-3 tok/s;
   - coder model turn 40-130 s.
2. The model is the bottleneck, not the plumbing. On CPU, qwen2.5-coder 7B Q4
   got a one-line ticket almost right, then could not fix its own miss
   (dropped the "!") across 3 turns and tried to edit the acceptance test
   instead.
   - Probe a bigger coder model that fits the card's VRAM (a 14B/32B coder at
     Q4) with the same scenarios.
   - The ≥4/5 bar decides.
3. Decide edit format (whole vs diff) and context size per model from the
   probe, not from defaults.

## Firm

- Claude seats and Claude packs are untouched by every slice.
- Nothing runs off the per-role `seat` allow-list; no seat ever composes shell.
- No pipeline script is ever in an aider seat's chat, editable or read-only.
- A local seat never hands off without red→green acceptance, a model commit,
  and an untouched spec.
- Until L2+L3 land, a stalled local pack is expected. Do not retry, reroute or
  re-dispatch tickets on it (BL-1687 is held by such a pack's coder right now;
  it needs a Claude seat or the driver).
