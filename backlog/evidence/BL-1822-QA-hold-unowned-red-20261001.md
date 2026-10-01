# BL-1822 — QA hold: unowned property red, 2026-10-01

Parcel commit: 3f42139c68 (documenter dbb5bcca94 merged into QA)
Red: extension/test/bl800StepRegistryScopingConsistency.property.test.js

- `npm run test:properties` (ONE run, qa-gather tmp/BL-1822-gather.json) exit 1; register_join names this file `absent` (no register row, no open ticket; `grep -rl bl800StepRegistryScopingConsistency backlog/` finds only closed-ticket evidence).
- Failing assertion line NOT captured verbatim: the gather keeps a 4000-char tail that shows only allowlisted BL-871 `[vitest-worker]: Timeout calling "onTaskUpdate"` lines. Lane run not repeated (one-run rule).
- The file run once alone at 3f42139c68: 2/2 passed in 6797 ms (tmp/BL-1822-bl800-alone.log). Neither deterministic nor flaky can be claimed from this.
- Every other gate: unit 0, acceptance 0 (3/3 per qa_e2e 1), sibling VERIFY, register 0; qa_e2e 2 prints "Model scout: no scout has run yet."; qa_e2e 3 Art Director LGTM (note 000022, model names bold, sample tmp/BL-1822-rendered-sample-2.txt). Prior D1 cleared.
- pre_qa_gate: FAIL ancestry 268bb8de94 stranded on swarmforge-documenter - a documenter evidence-only commit whose file content is byte-identical in the parcel (benign; the land step's pure-evidence stray path).
- Disposition: unowned-red note to specifier + coordinator; parcel waits for an owner, then resumes on 3f42139c68.

By QA.
