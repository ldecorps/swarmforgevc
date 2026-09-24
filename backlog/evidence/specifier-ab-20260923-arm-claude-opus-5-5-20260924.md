# Specifier A/B (2026-09-23) — Anthropic arm, claude-opus-5-5

Evidence for `backlog/INTAKE-operator-question-1790155120661.md` (the human's
A/B evaluation of the specifier role across providers). Recorded by the
live specifier seat, 2026-09-24.

Human, verbatim (Telegram LOCAL_AGENT, 2026-09-23T09:06:45Z): "Could we test
the specifier role for the local qwen by having it minting the 2 intakes
sitting on the queue, store this somewhere, so that tomorrow, when we have
anthropic tokens, have fable do the exact same exercise, and then we can
compare the results."

## Read this first: the arm is Opus 5.5, not Fable, and arm A never ran

- **Model.** The human asked for Fable for this arm. On 2026-09-24 the human
  changed the specifier seat to Opus 5.5 ("Change the specifier to opus
  5.5.", db5d1313e4), so this arm ran on `claude-opus-5-5`, not
  `claude-fable-5-1`. A Fable arm, if still wanted, is a separate run.
- **Arm A (local qwen) has no output to compare against.** Both corpus
  intakes were still in the backlog root, byte-identical to the pinned
  copies, when this seat started (sha256 below). The ISTA IQ3_S mono-router
  was timing out against the local endpoint on 2026-09-23. The overnight lab
  (`backlog/evidence/aider-seat-lab-20260924.md`) then found why no local
  aider seat could have drained them: headless aider has no command channel,
  so it cannot run the gates, the commit helper or the handoff. The
  comparison needs a sandboxed local run over the pinned corpus. It is
  recorded as a remaining slice on epic BL-1125 and waits for the GPU and
  your go-ahead.

## Resolved from the live process (not from the conf file)

| Item | Value | Where read |
|---|---|---|
| Pack | `full-forge` | `/proc/<specifier pid>/environ` `SWARMFORGE_PACK`; `.swarmforge/day_shift_pack` agrees |
| Model | `claude-opus-5-5` | `.swarmforge/launch/specifier.claude-settings.json` `model` (the process's `--settings` file) |
| Effort | `xhigh` | `swarmforge/packs/full-forge.conf` specifier window line |
| Seat process start | 2026-09-24T06:12:15Z | `ps -o lstart` |

## Corpus the arm read

| Intake | sha256 read (live root file) | Pinned (SHA256SUMS) |
|---|---|---|
| `INTAKE-operator-question-1790153120168.md` (ollama as a managed ancillary) | `253d81766c4dbe0d315f4440faebfec69d0e2bb6c41a94f113d8979e3f4afb23` | identical |
| `INTAKE-operator-question-1790153142349.md` (documenter as a callable role) | `7a7ca23ca24765e0ed1ef1ef43733a2049e18b9c144140bfd09cfa1659174b40` | identical |

Pinned copies: `.swarmforge/operator/benchmark-corpus-specifier-ab-20260923/`.

## What the arm produced

**Timing.**
- The seat started at 06:12:15Z and read both corpus intakes at the start
  of the root drain, around 06:13Z.
- It then minted the seven queue-jump tickets from the aider-seats intake
  first (priority order).
- Drafting the three intake-1 tickets ran from the BL-1702 commit
  (`033b40b2a5`, 06:34:41Z) to their own commit (`45ce8de392`,
  06:38:02Z).
- The intake-2 question was asked at 06:38:57Z.
- Read-to-output wall time is therefore not separable per intake. The
  commit times are the hard numbers.
- No model timeouts or retries.

**Intake 1 (ollama ancillary): minted, split 1:3.**
- BL-1703: launch probes and starts ollama; refuses on a dead endpoint.
- BL-1704: the full-stack stop and kill_all_swarm stop only a swarm-owned
  server.
- BL-1705: the orphan janitor reaps runners whose server is gone and
  detached run clients.

Tickets, verbatim in git:
`backlog/paused/BL-1703-*.yaml`, `BL-1704-*.yaml`, `BL-1705-*.yaml` and
their `specs/features/` files at `45ce8de392`. All are `human_approval:
pending` (a named ask, but not a jump request). Epic: `local-llm-swarm`
(BL-1125, linked).
- Design calls made at mint, stated in the tickets:
  - the swarm stops only a server it started (an external one may serve
    the Local Agent chat);
  - the probe lives in `swarmforge.sh`, not the per-pack wrappers, because
    the scheduled start bypasses them;
  - the janitor rule is parentage and age, never memory size.
- Asked back, not decided: automatic restart of a crashed server (not in
  the ask).

**Intake 2 (documenter as a callable role): not minted; one clarifying
question raised.**
- The question went through `role_ask.bb` to the specifier topic at
  2026-09-24T06:38:57Z.
- Options: A (keep the per-parcel docs pass as an on-demand job,
  recommended), B (drop the docs stage), C (keep the seat, add a publish
  CLI). Each option carried its pros and cons.
- The intake's five "needs specifying" points follow from that answer, so
  minting before it would have been guessing.

## Gates and refusals, as they happened

- `gherkin_lint_gate.sh`: all three feature files parsed cleanly on the
  first run.
- IR-DRY checker:
  - BL-1703 and BL-1705: 0 findings.
  - BL-1704: 4 medium findings, all one-step parameter variants or
    deliberate opposites. Left as they are.
- `specifier_backlog_hygiene_gate.sh`: ok. Before the commit it reports
  UNTRACKED-ACCEPTANCE by design (it is run again after the feature files
  are tracked).
- `pre_qa_gate_lib` `read-required-wiring`: every entry parsed. Every
  consumer anchor was checked absent on `main` at mint, so each one gates
  (BL-874, BL-1235).
- `commit_integrity_cli.bb`: success after 6 lock attempts (another writer
  held the lock). No refusal.

## Against the intake's comparison axes

1. **Mint or not.** Intake 1 minted (3 tickets). Intake 2 held behind one
   question.
2. **Ticket-shape validity.**
   - Acceptance: a Gherkin feature per ticket, linted, IR-DRY checked.
   - Standing-red register row: not applicable (not a red).
   - `depends_on`: BL-1704 names BL-1703, an unbuilt sibling. That is the
     current rule, not a defect. The intake's axis says "naming only
     landed siblings". The rule was changed 2026-09-22 (BL-1687): a
     sequencing that `depends_on` does not name is read by nothing.
3. **Would the gates pass.** The mint-time gates did. The pre-QA wiring
   anchors are built to fail until each consumer call lands.
4. **Hallucinated references.** Every existing path or name the tickets
   cite was opened or grepped before the mint:
   - `swarmforge.sh`'s `DEFAULT_LOCAL_MODEL_ENDPOINT_URL`;
   - `stop_ancillary_services.sh`, `kill_all_swarm.sh` (BL-611 babysitterd
     exception);
   - `orphan_janitor_sweep_lib.bb`'s `orphan-janitor-lib/reapable-*?`
     calls;
   - `launch_local_agent.sh`'s auto-start;
   - `start-swarm-ollama-*.sh`.

   Names that do not exist yet are fixed deliberately at mint and say so:
   `ollama_ancillary_lib.sh`, `reapable-ollama-ghost?`.
5. **Usefulness.** The human's call.

## Open questions the intake left to the specifier

1. **Do an experimental arm's mints enter the live backlog?**
   - This arm is the production seat doing real, wanted work, so its mints
     are live.
   - Any further arm (local, or a Fable re-run) should write to a
     quarantined sandbox copy of the repo and never the live backlog. The
     corpus is pinned, so live mints here do not consume it.
2. **Comparison axes.** The intake's five, as above.
3. **Who runs a further arm.**
   - Not live rotation: a local aider seat cannot drive the gates (lab).
   - It is an operator or model-steward run in a sandbox, on the GPU. It
     is recorded as a remaining slice on BL-1125.
