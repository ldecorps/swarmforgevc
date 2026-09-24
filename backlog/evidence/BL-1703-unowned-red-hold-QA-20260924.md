# BL-1703 - QA hold on an unowned red (Article 4.2), 2026-09-24

Parcel commit: a6a5b51a5c ("Merge documenter 738e99a767 into QA.")
Red paths:
- extension/test/emitLifecycleSnapshotCli.test.js
- extension/test/telegramFrontDeskBotCli.test.js

`npm test` (extension/, one run via qa-gather.js, host load average about 10)
passed every test, then exited 1 on the suite's per-file budget guard.
Verbatim:

    suite file budget exceeded:
    2 new-pole offender(s):
    extension/test/emitLifecycleSnapshotCli.test.js: 10.9s exceeds the 7.0s per-file budget
    extension/test/telegramFrontDeskBotCli.test.js: 11.3s exceeds the 7.0s per-file budget

BL-1703 touches neither file. Neither file has a row in backlog/standing-reds.tsv
or backlog/suite-poles.tsv. A grep of backlog/ finds both named only in the
paused epic BL-791 (unit suite speed), and telegramFrontDeskBotCli also in
paused BL-1596. So the parcel waits for an owner; this is not a bounce.

BL-1703's own gates in the same pass: property suite green; acceptance (the
BL-1703 feature) green; pre_qa_gate OK; qa-sibling-check VERIFY. qa_e2e step 2:
the probe runs right after parse_config and before any session is created, and
only for packs on the local endpoint. Step 3: test_alternate_runtime_launch.sh,
test_ollama_ancillary_launch_gate.sh, test_aider_seat_launch_config.sh and
launch_contract_test_runner.bb all pass.

By QA.
