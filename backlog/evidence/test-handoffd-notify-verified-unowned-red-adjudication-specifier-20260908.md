# test_handoffd_notify_verified.sh: unowned red, adjudication (specifier, 2026-09-08)

Inbound: coder note, priority 00, 2026-09-08T08:19:06Z, "unowned-red:
test_handoffd_notify_verified.sh 02 wake typed once check got 0", raised from
the BL-1490 parcel (second note of the morning; the first became BL-1498).
Handled the same pass under the standing-red rule (2026-09-05): `type:
defect`, `severity: high`, register row in the mint commit. Outcome:
**BL-1499 minted** (paused), owner of one row.

## Reproduction on main `974f03e9e1` (master checkout, `RESEND_API_KEY` unset)

    $ bash swarmforge/scripts/test/test_handoffd_notify_verified.sh
    PASS: 01: healthy pane confirms submit on the first try, no failure logged
    FAIL: 02: must type the wake message exactly once, never re-type on retry, got 0
    (exit 1; cases 03-05 never run)

Also red under `ZDOTDIR=<empty dir>` (BL-1498's discrimination): not the
zsh-startup-file cause. `standing` row, `suite-manifest.tsv` line 311.

## Cause

A debug copy of the test (HANDOFFD pinned, the fake's call log and the
daemon log printed after case 02's `run_notify`) shows the call order:

    has-session -t swarmforge-coder   (x2)
    capture-pane -p -t swarmforge-coder        <- handoffd.bb:646 recipient-pane-busy? (startup-notify-pending!)
    has-session -t swarmforge-coder   (x2)
    capture-pane -p -t swarmforge-coder        <- agent_runtime_inject.bb:95 `before` (BL-093 pre-inject check)
    send-keys C-m / send-keys C-j / capture-pane   (x3, the submit retry loop)

    handoffd.log: notify-delivery-failed swarmforge-coder pane already held
                  undelivered input and it still would not submit

The fixture's fake (`test_handoffd_notify_verified.sh:52-64`) answers the
FIRST `capture-pane` with `BEFORE_STDOUT_FILE` and every later one with
`AFTER_STDOUT_FILE`. The busy probe consumed the idle reply; the pre-inject
check read the stuck wake text, set `stacked?`, typed nothing, and ran the
recovery submits. Zero literal sends.

- Busy gate on this path: `36ae0a8e23`, 2026-07-22, "Skip handoff delivery
  wakes when recipient pane is busy" (the blame shows `e52261521e` 08-27, a
  recovery commit that re-tracked the file; `git log -S` finds the origin).
- Test last edited `09ccb47342`, 2026-07-15. Red since 2026-07-22.
- Written down, never minted: BL-576 architect review 2026-07-23 line 75
  ("test_handoffd_notify_verified.sh case 02"); BL-1273 QA pass 2026-08-29
  lines 142-147 (six handoffd tests "reproduced byte-for-byte identically").
- Production is right: the busy probe (BL-135 parity, reworked by BL-970 on
  08-30) and the stacked-input check ask different questions of the same
  pane. `test_handoffd_startup_notify.sh`, whose fake is not sequenced,
  drives the same path and is green (run 2026-09-08, exit 0).
- Wake dedup (BL-1191, `.swarmforge/daemon/wake-dedup/`) is NOT a cause:
  `run_notify` removes `.swarmforge/daemon` between cases.

## Fix shape

The fake keys its reply on whether the literal send (`send-keys -l`) has
happened - a marker file `TYPED_FILE` - not on a capture count. Case 02's
contract (one literal send, retried submit, logged failure) is unchanged;
cases 03/04 (stuck before anything is typed) keep their meaning because both
probes then read the stuck pane.

## Recorded, not ticketed

- Two `capture-pane` reads per wake in production (busy gate + pre-inject
  check), each behind two `has-session` calls: four tmux round trips before
  a byte is typed. A cost note for the BL-1493 family.
- The class "a fake that encodes the caller's probe count": grep the shell
  tests for `CAPTURE_COUNT` / sequenced replies before the next one rots.
- Two written sightings (day 1, day 38) produced no ticket; the owner came
  on day 48 from a coder tripping over it. Same lean-pass candidate as
  BL-1498's evidence: a review or QA pass that lists a known red is an
  unowned-red note.
