# BL-2014 QA hold on an unowned red (2026-10-06)

parcel_commit: 6ebabfb995
red: swarmforge/scripts/test/test_handoffd_ambulance_wiring.sh

## The parcel's own gates, all clean

Stamp-off of hotfixes 77584c4c11 and 4a4063fdc0. The parcel adds only the coder's evidence
(merge-base 703f1a4aaa contains both hotfixes and c15a0f21aa).
- qa_e2e 1-4, one run each at 6ebabfb995: test_tmux_exact_session_presence 3/3,
  test_swarm_ensure 51/51, test_babysitter_check 20/20,
  test_handoffd_bl812_cwd_invariant_root_resolution 9/9, test_consult_spawn_cli 4/4,
  test_chase_departing_mid_parcel_gate 13/13, test_handoffd_aged_note_rotate_wiring ALL PASS,
  test_handoffd_ambulance_wiring 6/6 ALL PASS (ambulance-hold-05 included).
- qa_e2e 5: BL-648 7/7, BL-938 4/4, BL-571 4/4.
- qa-gather at 6ebabfb995, one run: sibling VERIFY; register exit 0 (unowned []);
  pre_qa_gate OK; unit exit 0; properties exit 0 (436 s); acceptance (BL-1798) 8/8;
  register_join []. The before-run straggler hits were another seat's vitest; none after.
- The coder's review matches `git show 77584c4c11 4a4063fdc0` against the description and
  the invariant.

## The red

The coder's committed evidence (6ebabfb995, `BL-2014-coder-20261006.md` item 4) records
`test_handoffd_ambulance_wiring.sh` ambulance-hold-05 FAILING, reproduced twice, on the
same test code as QA's passing run. Same tree, fail, fail, pass: the red is intermittent,
measured. No row in backlog/standing-reds.tsv names it, and no open ticket mentions the
file except this stamp-off's own qa_e2e. 4a4063fdc0, a hotfix this ticket stamps off, is
the file's last change on main.

Mechanism (read from the test, lines 222-242): scenario 05 starts a real
`bb handoffd.bb` on a tmp root and allows a FIXED 40 s (`DEADLINE=$(( $(date +%s) + 40 ))`)
for the daemon to boot and log its first `chase-rotate (architect|documenter)` line.
Otherwise it fails with the only text that branch prints:
`ambulance-hold-05: the resident was never rotated to architect for the ambulance ticket; log: <handoffd.log>`.
The coder's description: "the daemon starts and logs heartbeats but never emits the
rotation". Their log text was not kept. A fixed wall-clock deadline on a live daemon's
first sweep is load-sensitive. The coder's seat shares the host with the local-model
coder's inference, and QA's run, at load ~4, passed.

Resume: once an owner exists, re-run the gate on 6ebabfb995 (merge main first if it moved)
against the register as it then stands, approve and queue the land, then
`qa_hold_cli.bb close --task BL-2014 --outcome approved`.
