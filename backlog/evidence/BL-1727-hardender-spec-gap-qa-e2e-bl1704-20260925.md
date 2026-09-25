# BL-1727 hardener spec-gap: qa_e2e_procedure step 3 names BL-1704 green

BL-1727's `qa_e2e_procedure` step 3 says: "The BL-1703 and BL-1704 features
and test_ollama_ancillary_launch_gate.sh: green." BL-1703's feature and the
launch-gate test are genuinely green (verified this pass). BL-1704's feature
is not, and cannot be right now:

- `backlog/paused/BL-1704-the-swarm-stop-paths-stop-the-ollama-server-the-swarm-started.yaml`
  is `status: todo` — BL-1704 itself has not been implemented.
- `specs/features/BL-1704-the-swarm-stop-paths-stop-the-ollama-server-the-swarm-started.feature`
  was minted (commit `45ce8de392`, alongside BL-1703/BL-1705) but never
  given a step handler — `grep -rl "BL-1704" specs/pipeline/steps/` finds
  nothing, and `required_wiring` in BL-1704's own ticket names
  `specs/pipeline/steps/bl1704OllamaStopPathsSteps.js`, which does not
  exist.
- `node specs/pipeline/cli.js specs/features/BL-1704-...feature`: 5/5
  `not ok`, every scenario `no step handler matched "Given a throwaway
  project with a stand-in ollama server and one runner child"` — this is
  the expected shape of an unimplemented feature, not a regression BL-1727
  caused (BL-1727 touches only `ollama_ancillary_lib.sh`'s
  `ollama_ancillary_stop_pid`/`ollama_ancillary_wait_gone`, which BL-1704's
  future implementation will call, per BL-1727's own description).
- `stop_ancillary_services.sh` and `kill_all_swarm.sh` (BL-1704's own
  `required_wiring` targets) have no `ollama` reference at all yet —
  confirming BL-1704's implementation genuinely has not landed.

This is a false premise in BL-1727's own `qa_e2e_procedure`, not a defect
in BL-1727's Scope (`ollama_ancillary_lib.sh` and its own test/property/
acceptance files, all green — see `backlog/evidence/BL-1727-hardender-
20260925.md`). QA will hit the same "not ok" wall step 3 describes as
"green" unless this line is corrected (drop the BL-1704 clause, or make it
conditional on BL-1704 having landed by the time BL-1727 reaches QA).

Not routed as a parcel or a bounce — BL-1727 itself needs no code change
for this; it is a wording correction to BL-1727's own qa_e2e_procedure,
for the specifier to make.

By hardender.
