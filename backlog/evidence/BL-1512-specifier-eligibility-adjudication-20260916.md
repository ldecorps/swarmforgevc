# BL-1512 coder eligibility note - specifier adjudication (2026-09-16)

Inbound: `00_20260916T121343Z_001982_from_coder_to_specifier`, "BL-1512:
5/7 picks ineligible (cursor/qwen unregistered), see evidence". Coder
evidence (coder worktree, bfeae57604):
`backlog/evidence/BL-1512-coder-verdict-20260916.md`. The coder followed
the ticket's own stop-and-report route and wrote no pack. Correct.

## Re-run on the launch root (master checkout, `.swarmforge/model-steward/` live)

`bb swarmforge/scripts/model_steward_cli.bb status`: anthropic/claude-sonnet-5,
anthropic/claude-fable-5-1, cursor/auto, openai/gpt-5.3-codex,
qwen/qwen3.7-plus, tencentcloud2/glm-5.3-flash all `certified`. The
coder's worktree registry (gitignored, dated 2026-09-06) knows three.

`eligible <provider>/<model> --role <role>`, no override:

| seat | pick (gate-resolved id) | verdict |
|---|---|---|
| specifier | cursor/auto | eligible |
| coder | openai/gpt-5.3-codex | eligible |
| cleaner | cursor/auto | eligible |
| architect | openai/gpt-5.3-codex | eligible |
| hardender | cursor/auto | eligible |
| documenter | qwen/qwen3.7-plus | eligible |
| documenter | openai/qwen3.7-plus (the coder's id) | ineligible - not a steward id; aider's `--model openai/...` prefix is its OpenAI-compatible routing, the gate maps the Token Plan host to provider qwen |
| QA | cursor/auto | eligible |

All seven picks are eligible on the launch root. The coder's 5-of-7 came
from worktree staleness plus one id spelling.

Staffing gate, windows-file in the shipped packs' agent syntax
(`cursor --model auto`, `codex --model gpt-5.3-codex`, the
qwen-mono-router.conf aider Token Plan line), `env -u PACK_STAFFING_SKIP_GATE`:

```
specifier   pass    cursor  auto
coder       refuse                        seat-model-unresolved
cleaner     pass    cursor  auto
architect   refuse                        seat-model-unresolved
hardender   pass    cursor  auto
documenter  refuse  qwen    qwen3.7-plus  role-gate-not-pass
QA          pass    cursor  auto
```

- cursor/auto: `scorecards/cursor__auto.json` carries specifier-gate,
  cleaner-gate, hardener-gate, QA-gate (and the rest) pass -> the four
  cursor seats pass every check.
- codex: `agent-model-providers` in `pack_staffing_gate_lib.bb` has no
  codex row, so check 1 fails before evidence is read. A gate defect, not
  a pick defect: **BL-1597** minted this pass.
- qwen/qwen3.7-plus: `scorecards/qwen__qwen3.7-plus.json` carries
  specifier/architect/hardener/coder gates pass but no documenter-gate
  entry (the 2026-08-29 battery did not run documenter). Steward work:
  `bb swarmforge/scripts/compliance_battery.bb gate documenter <root>
  <sha>` then `model_steward_cli.bb show qwen/qwen3.7-plus`. The
  operator's to schedule; recorded, not ticketed.

## Ruling

The FIRM picks stand (all eligible on the launch root). The FIRM "gate
passes without the hatch" was the specifier's unverified premise, the
same defect as BL-1511's: amended so the pack is written with the picks,
the LAUNCH line keeps `PACK_STAFFING_SKIP_GATE=1`, the PREREQ names the
three verdicts above and what clears each, scenario 02 gates the pack's
shape against a steward FIXTURE over the cursor and qwen lines (with a
sensitivity row), eligibility moves to the e2e on the master root with
the gate-resolved ids, and the codex lines are asserted nowhere until
BL-1597 lands (BL-1006). The coordinator ruling is untouched;
human_approval stays approved. No bounce recorded.

## Pattern the coder flagged, confirmed

Two tickets split from one intake, both minted with gate claims the
specifier never ran correctly, both caught by the coder on the same day:
BL-1511 (raw pack file passed as the windows-file -> vacuous pass) and
BL-1512 (a FIRM written from the intake's scores, never run). The
per-worktree `.swarmforge/model-steward/` staleness is real and separate:
any acceptance that reads it is green or red by which worktree runs it.
Rule going forward (specifier memory): never write a FIRM about a gate's
verdict without running that gate, correctly shaped, on the launch root,
and never let a scenario read gitignored steward state.
