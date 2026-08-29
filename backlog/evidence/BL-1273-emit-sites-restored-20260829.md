# BL-1273 — the five self-heal emit sites, restored and measured

Coder, 2026-08-29.

## Baseline, recorded before any change (qa_e2e step 1)

    $ grep -rn "append-self-heal-event!" swarmforge/scripts/*.bb swarmforge/scripts/*.sh
    swarmforge/scripts/self_heal_telemetry_cli.bb   (1)
    swarmforge/scripts/self_heal_telemetry_lib.bb   (1)

Two hits, neither a recovery host. And:

    $ grep -n self_heal_telemetry swarmforge/scripts/handoff_lib.bb
    48:(load-file ... "self_heal_telemetry_lib.bb")

One hit: the dead load-file, exactly as the ticket describes.

The standing property test was red at the same commit:

    × invariant1 property: every known host still loads the shared lib (no parallel writer)
      AssertionError: The input did not match the regular expression /self_heal_telemetry_lib/

## The dropping merge, confirmed (qa_e2e step 2)

    $ git show -s --format=%s 2e37477ec
    Merge tip-pure BL-1185 hardener rematch into hardender branch.

Its subject names BL-1185, not BL-597. `git show 2e37477ec --` shows nothing
for the host files; the hunks are only visible with
`--diff-merges=first-parent`, which is why no missing-module error ever
surfaced this — the merge dropped HUNKS inside surviving files.

## The five sites

Restored verbatim in intent from BL-597's own commit `70c81c0ed`, each beside
the prose-log anchor it observes. All five anchors were verified present at
HEAD before editing, so no new detection path was invented:

| event | host | anchor it sits at |
|---|---|---|
| stale-build-recompile | front_desk_supervisor.bb | `log! "stale-build-detected"` |
| supervisor-respawn | front_desk_supervisor.bb | the `:started` case arm |
| claim-heal | handoffd.bb | `in-process-resume-steps` |
| rotation-respawn | handoff_lib.bb | `append-rotation-event!` |
| kill_all | kill_pipeline_swarm.sh | `log "kill_all_swarm SUCCESS"` |

Two load-files came back with them (front_desk_supervisor.bb, handoffd.bb);
handoff_lib.bb's was already there and is no longer dead.

Invariant 2 holds by construction at every site: `append-self-heal-event!`
swallows its own failures inside the lib, the `:started` arm wraps the emit in
a `do` AFTER the prose log so the arm's value is unchanged, and the bash site
is `>/dev/null 2>&1 || true` so it cannot touch the script's exit status under
`set -e`.

## After (qa_e2e steps 3, 4, 5)

    front_desk_supervisor.bb  loads=1 calls=3   (2 emits + 1 in a comment)
    handoffd.bb               loads=1 calls=1
    handoff_lib.bb            loads=1 calls=1
    kill_pipeline_swarm.sh    self_heal_telemetry_cli.bb (1)

No script loads the lib without calling it. Both bb daemons parse cleanly
(`front_desk_supervisor.bb` 74 forms, `handoffd.bb` 360 forms); `bash -n`
passes on the shell host.

The headline observable, `selfHealTelemetry.property.test.js`: **7/7 pass**,
including both invariant1 tests that were red.

Acceptance: 7/7. Non-vacuity of the acceptance itself — replacing the
handoff_lib.bb emit with a non-call turns 3 of the 7 red (the outline row for
rotation-respawn, the no-dead-load scenario, and the property scenario), then
green again once restored.

## Two things QA should know before running step 6

**(1) I did not run the live end-to-end.** Step 6 asks for a real
`kill_pipeline_swarm.sh` run with the swarm up. That tears down the running
swarm this parcel is being built inside; it is QA's step to run at a moment of
its choosing, not mine to fire mid-pipeline.

What I did instead, which proves a production writer exists without killing
anything — the same CLI invocation the restored kill_pipeline_swarm.sh line
makes, against a throwaway root:

    $ bb swarmforge/scripts/self_heal_telemetry_cli.bb /tmp/shprobe "a kill_all_swarm invocation"
    ok
    lines: 1
    {"type":"kill-all-swarm","subject":"lifecycle","reason":"clean slate","at":"2026-08-29T14:29:45.101Z"}

One line, appended, well-formed.

**(2) The type is `kill-all-swarm`, not `kill_all`.** Step 6 says to confirm
the new line's `type` is `kill_all`; the CLI's own `action-map` maps that
action to `"kill-all-swarm"`, and the property test's `typeArb` lists
`kill_all`. Both predate this ticket. I did not reconcile them: the ticket's
constraints forbid changing the `:type` vocabulary, forbid touching
`self_heal_telemetry_lib.bb`, and the CLI is one of BL-1262's restored files.
So step 6 will see `kill-all-swarm` and that is the correct current behaviour —
flagged here so it does not read as a failure of this parcel. Whether the two
spellings should be reconciled is a separate question for the specifier.

## Regression (qa_e2e step 7)

Full unit suite unchanged: 20 failing files, 33 failing tests, identical to the
baseline before this parcel. The selfHealTelemetry property failure never
appeared in that count because property tests run in their own lane
(`npm run test:properties`), which is where the drop shows: that file went from
1 failing test to 0. No other file changed status in either direction, and no
recovery path changed its exit status.

## Untouched, deliberately

`extension/test/selfHealTelemetry.property.test.js` and its `KNOWN_EMIT_HOSTS`
list, `self_heal_telemetry_lib.bb`, the aggregator, the trend computation, the
CLI's action map, and `docs/how-to/BL-597-trend-self-heal-events.md` — whose
claim that the emits sit at the existing prose-log sites is true again as of
this commit, which is what the ticket asked for instead of a doc edit.
