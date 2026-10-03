# BL-1861 bounce fix (coder)

Fixes D1 from `backlog/evidence/BL-1861-bounce-20261003.md` (hardener,
blamed commit 6d599d2ec0 - the mis-attributed bounce_history entry naming
895db5a4f2 was hardener's own clerical correction, not this fix's target).

## The defect

`parse-launch-script`'s regexes took the FIRST match in the script text
for both `OPENAI_BASE_URL=` and `--model`. The real generated launch
script (`write_role_launch_script`, `swarmforge.sh`) concatenates every
agent's guard block before `launch_body`:

- An EARLIER, inert, quoted `cerebras_guard` line
  (`OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.cerebras.ai/v1}"`,
  never executed for a local-model seat but textually present) sits
  before `local_model_guard`'s own real, unconditional assignment.
- `local_seat_settings_snapshot_cli.bb`'s own quoted `--model` recording
  call (BL-1850) sits before the real qwen command line, whose own
  `--model` value is spliced in UNQUOTED.

Taking the first match read the inert guard's unexpanded
`${OPENAI_BASE_URL:-...}` text as the endpoint, and never matched the
real (unquoted) model value at all - it happened to read a coincidentally
correct model name only because the snapshot CLI's recording call and the
real qwen command shared the same value on this host today. Confirmed
live: `bb -e '... (lib/parse-launch-script (slurp ".../launch/coder.sh"))'`
returned `{:model "ista-iq3s-coder:latest", :endpoint
"${OPENAI_BASE_URL:-https://api.cerebras.ai/v1}"}` before the fix.

## The fix

`parse-launch-script` now takes the LAST match for both fields (every
later-emitted guard legitimately overrides an earlier one; `launch_body`,
carrying the real command, is always last), and accepts an unquoted
`--model` value (quoted still works too - the regex tries `'...'`, then
`"..."`, then a bare `\S+` word).

Re-ran the exact live check after the fix:
```
{:model ista-iq3s-coder:latest, :endpoint http://127.0.0.1:11439}
```
Cross-checked against the live script directly (`grep -n
"OPENAI_BASE_URL=\|--model" .swarmforge/launch/coder.sh`): line 60 is the
real, last `OPENAI_BASE_URL='http://127.0.0.1:11439/v1'` assignment; line
62 is the real, last, unquoted `--model ista-iq3s-coder:latest` on the
qwen command line. Both now read correctly, and for the right reason
(the actual governing line), not coincidence.

## What else changed

- `local_llm_lib_test_runner.bb`: two new cases built from a slice of the
  real guard-block shape (cerebras_guard + the snapshot CLI's own
  recording call + an unquoted qwen `--model`) - one pinning the live
  host's own values, one proving a DIFFERENT real model than the
  recording call's still reads correctly (the exact silent-wrong-unload
  risk the bounce evidence flagged).
- `test_bl1861_local_llm_remove.sh`'s `launch_script()` fixture: rewritten
  to the same real shape (inert cerebras guard line, the snapshot CLI's
  own quoted call, an unquoted qwen `--model`) rather than the idealized
  two-line script - all 24 scenario assertions still pass against it.

## Verification run

- `bb swarmforge/scripts/test/local_llm_lib_test_runner.bb`: ALL PASS.
- `bash swarmforge/scripts/test/test_bl1861_local_llm_remove.sh`: ALL
  SCENARIOS PASSED (24/24), now against the realistic fixture.
- `node specs/pipeline/cli.js specs/features/BL-1861-....feature`: 8/8 ok.
- `bb swarmforge/scripts/test/bl1861_local_llm_remove_property_runner.bb`:
  ALL PROPERTIES HELD (all three declared invariants, unaffected by this
  fix's scope).
- `bash swarmforge/scripts/check_shell_test_early_exit_pipe.sh --scan-tree`:
  clean (no new pipefail/early-exit-grep instances introduced).
- Live host re-check: see above, now correct.

By coder.
