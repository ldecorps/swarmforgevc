# BL-149 QA bounce — cooldown gate built but never wired into the hardener

## Failing command
```
grep -n "cooldown\|mutation_cooldown" swarmforge/roles/hardender.prompt
```
(no output — exit 1, no match)

Corroborating check — the new gate script is referenced nowhere outside its own files:
```
grep -rln "mutation_cooldown_gate\|mutation_cooldown_lib\|mutation_cooldown_days" . \
  --include="*.prompt" --include="*.md" --include="*.sh" --include="*.bb" \
  | grep -v "/scripts/mutation_cooldown_\|/scripts/test/"
```
(no output)

## Commit hash tested
`b9439cad2f` (documenter's handoff, `BL-149-mutation-cooldown-gate`), merged into
QA at `c8a2ba49a3`.

## First error excerpt
`swarmforge/roles/hardender.prompt` still only contains the OLD prose-only
office-hours bypass, unchanged by this parcel:

```
40:- Before any mutation or full-suite run, check `uptime`: if the load average
41-  exceeds ~2x the core count, wait for it to subside or fall back to targeted
42-  tests instead of assuming a stuck run is a code defect. (...)
...
59:- Office-hours mutation bypass (operator policy, 2026-07-06): DURING OFFICE
60-  HOURS, bypass heavy mutation testing on RECENTLY-MODIFIED files — defer the
61:  expensive full mutation pass to the off-peak/overnight window. (...)
```

No line anywhere in the file mentions a cooldown, a file-change age check, or
`mutation_cooldown_gate.bb`.

## Failure class
`behavior`

## Expected vs observed
Expected: the ticket's own description points straight at
`swarmforge/roles/hardender.prompt` ("Office-hours mutation bypass") and asks
for "a new first-stage gate, ahead of the existing load check" in that same
process — i.e. the hardener's actual instructions must tell it to consult the
cooldown decision before falling back to the load-average bypass, so acceptance
scenarios cooldown-gate-01..04 ("When the agent considers whether to run
mutation testing...") hold in the live swarm.

Observed: `mutation_cooldown_lib.bb` (pure decision logic) and
`mutation_cooldown_gate.bb` (CLI wrapper reading real git history/load
average/`swarmforge.conf`) are both correctly implemented and pass their own
tests (`test_mutation_cooldown_gate.sh` — all 5 cases green). The two new
`swarmforge.conf` keys (`mutation_cooldown_days`, `mutation_busy_load_multiplier`)
are wired to the library correctly. But nothing calls the new script: it is not
referenced from `hardender.prompt`, any other role prompt, or any other script
in the repo. The hardener — a Claude agent that acts only on its role prompt —
has no instruction to ever run `mutation_cooldown_gate.bb`, so the gate has zero
effect on real mutation-testing decisions. The feature is built and unit-tested
in isolation but not integrated; the acceptance criteria describe agent
behavior that cannot occur as shipped.

Fix: add a step to `swarmforge/roles/hardender.prompt`'s mutation section
(ahead of the existing `uptime` check at line 40) instructing the hardener to
run `mutation_cooldown_gate.bb <root> <file>` per changed file and honor its
`DECISION:` line (`skip-cooldown` / `skip-busy` / `run`) before falling back to
the existing prose-only load check — consistent with how the ticket frames this
as a first-stage gate ahead of the current bypass, not a replacement for it.
