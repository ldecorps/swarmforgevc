# BL-1511 coder spec-gap note - specifier adjudication (2026-09-16)

Inbound: `00_20260916T121004Z_001981_from_coder_to_specifier`, "BL-1511
spec-gap: staffing-gate premise unverified, see evidence". Coder evidence
(coder worktree, commit 6a09fb7d06):
`backlog/evidence/BL-1511-coder-spec-gap-20260916.md`.

## The coder is right, and the defect is the specifier's

The ticket's premise - "measured 2026-09-10 by the specifier,
`pack_staffing_gate_cli.bb` reads `pass` on every b.ai line ... so the
hatch is not required" - was produced by passing the RAW PACK FILE as the
CLI's `<windows-file>` argument. The CLI splits each line on tabs
(`str/split line #"\t" 4`); the pack has none, so every line, comments
included, resolves no seat and prints a vacuous `pass`. Nothing was
measured. The coder built a correctly shaped windows-file and got
`not-on-role-matrix` refusals in its worktree, and asked whether that
worktree's gitignored steward copy was merely stale.

## Verified on 2026-09-16 (read and run, not guessed)

Windows-file derived from the pack's seven `window` lines (six workers on
main plus the coder's specifier line at 6a09fb7d06) by the launcher's own
field rules (`swarmforge.sh` parse_config: role, agent, worktree, optional
task|batch, optional propagation, optional idle-clear, rest = extra-cli;
stage = role). Every line resolves a provider/model - the old PREREQ
reason (no `["aider" "openai/glm-5.3-flash"]` agent-model-providers row)
no longer holds.

- **Master root** (`/home/carillon/swarmforgevc`, the launch root; runtime
  registry ranks tencentcloud2/glm-5.3-flash on coder/cleaner/architect/
  hardender/documenter/QA and anthropic/claude-fable-5-1 on specifier, all
  1.0 by live-battery evidence), `env -u PACK_STAFFING_SKIP_GATE`:
  ```
  coder      refuse  tencentcloud2  glm-5.3-flash     role-gate-not-pass
  cleaner    refuse  tencentcloud2  glm-5.3-flash     role-gate-not-pass
  architect  refuse  tencentcloud2  glm-5.3-flash     role-gate-not-pass
  hardender  refuse  tencentcloud2  glm-5.3-flash     role-gate-not-pass
  documenter refuse  tencentcloud2  glm-5.3-flash     role-gate-not-pass
  QA         refuse  tencentcloud2  glm-5.3-flash     role-gate-not-pass
  specifier  refuse  anthropic      claude-fable-5-1  role-gate-not-pass
  ```
  Cause: `.swarmforge/model-steward/scorecards/` holds no
  `tencentcloud2__glm-5.3-flash.json` and no
  `anthropic__claude-fable-5-1.json`; check 3 (`role-gate-passed?`) needs
  an entry `{competency: "<role>-gate", status: "pass"}` and fails closed
  on a missing scorecard, as designed.
- **Committed seed only** (`swarmforge/model-steward/seed/models.seed.json`
  copied into a scratch root - a fresh checkout, or any worktree whose
  gitignored copy predates the registry writes; the coder's dates from
  2026-09-06 and carries neither model): every line `refuse
  not-on-role-matrix`. The seed names neither model.

So the hatch is required on every root today, for two different reasons,
and the worktree staleness the coder suspected is real but not the whole
story.

## Ruling

1. **The hatch stays.** The PREREQ is rewritten to the truth: the real
   failing check (`role-gate-not-pass` on this host, `not-on-role-matrix`
   on a checkout without the runtime registry), both models, and the
   steward command that clears it (`bb swarmforge/scripts/compliance_battery.bb
   gate <role> ...` then `bb swarmforge/scripts/model_steward_cli.bb show
   <provider>/<model>`). The LAUNCH line keeps `PACK_STAFFING_SKIP_GATE=1`.
   The old agent-model-providers sentence goes.
2. **Scenario 02 is a fixture, not the live root.** The acceptance builds
   a scratch steward root (registry role-matrix entries + scorecards with
   `<role>-gate` pass entries, the hy3 scorecard's shape), derives the
   windows-file by the launcher's rules, pins it at 7 lines, and runs the
   real CLI with the hatch unset: row 1 (specifier model certified) ->
   every line pass; row 2 (no specifier entry) -> the specifier line
   refuses `not-on-role-matrix`. A vacuous invocation cannot pass row 2
   (BL-1445). `.swarmforge/` is gitignored per-worktree runtime state; an
   acceptance that reads it is green or red by which worktree runs it.
3. **Scenario 03's launch step is literal**: LAUNCH carries the hatch;
   PREREQ names `role-gate-not-pass` and the steward command.
4. The e2e's live-root check keeps the CORRECT invocation against the
   master root and records the verdicts verbatim; the header must match.
5. The human ruling (claude-fable-5-1 via claude) is untouched;
   `human_approval` stays approved; the coder's partial 6a09fb7d06 stands.

Committed on main (this commit); the coder, holding the parcel, is sent
the merge-and-re-read note (Article "Amending An In-Flight Ticket's
Spec"). No bounce recorded: the coder produced nothing wrong, and
`record-bounce.js` cannot name the specifier as the producing role.

## Recorded, not ticketed

- `.swarmforge/swarm.env:77` exports `PACK_STAFFING_SKIP_GATE="${PACK_STAFFING_SKIP_GATE:-1}"`
  (human, 2026-09-04: full-forge's specifier seat could not be resolved
  then). Every launch on this host skips the gate regardless of any
  pack's LAUNCH line, warning per seat on stderr. An operator file;
  surfaced for the operator to keep or retire once seats are certified.
- Certifying the seats for real: compliance battery gates per role for
  tencentcloud2/glm-5.3-flash (six roles) and anthropic/claude-fable-5-1
  (specifier), recorded as scorecards; the committed seed also lacks both
  models, so a fresh checkout refuses at check 2 even after that. Steward
  work with live provider calls - the operator's to schedule, not a
  pipeline parcel.
- BL-1512 (same intake, same author) required its picks to pass the gate
  without the hatch and told the coder to report failures rather than
  write the pack; the coder's bfeae57604 reports 5 of 7 picks failing.
  That ticket's own route handled its premise; adjudicate it on its own
  note if one comes.
