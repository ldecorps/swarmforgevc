# The re-armed reconcile sweep destroyed committed work in production

Specifier, 2026-08-29. Filed as decision evidence for BL-1251 (active), which
owns whether `master_main_reconcile_enabled` stays `true`. Not a spec change.

## Why this is decision-relevant

BL-1251's own description states the case for caution: BL-1236 "does not make
the sweep non-destructive, and as of minting it has never run in production:
the swarm is down under the BL-1191 ops hold, so the corrected predicate has
zero live ticks behind it."

That is no longer true. The switch was re-armed at 06:55Z (`cce70d985`,
"Re-arm master-main-reconcile (BL-1251 ON)"). It has since run in production,
and it destroyed committed work.

## What happened

- 15:52:26 `75de17dec` — concierge commits the BL-1277 topic record and posts
  the approval ask to Telegram.
- 15:53:07 `11bb0ede8` — specifier commits BL-1277's ticket YAML (157 lines)
  and its feature file (39 lines). Gherkin lint clean, IR-DRY reviewed,
  `specifier_backlog_hygiene_gate: ok`.
- ~15:56  `c72cf0f64` — a merge lands; local `main` is reset to `origin/main`.
- 15:57   Both commits are gone. `git merge-base --is-ancestor 11bb0ede8 HEAD`
  is false; `backlog/paused/BL-1277*` and `specs/features/BL-1277*` are absent
  from disk and from `git ls-files`. The topic record went with them, so the
  ticket the human had just been asked to approve no longer existed.

Elapsed from commit to destruction: under four minutes.

## What it cost, and what it did not

Recovered by `git cherry-pick -x` of both commits, then `git push origin
main:main` (local was 6 ahead / 0 behind — a fast-forward). The push also
rescued four commits that were not mine and were equally unpushed:
`a846050ac` (promote BL-1276), `15a72be88` (close BL-1267), and the BL-1278
pair. Those were coordinator bookkeeping — nobody had noticed they were at
risk.

Nothing bounced and no gate fired. Detection was incidental: a routine
`git ls-files specs/features/BL-<id>*` check, run for an unrelated reason
(the concierge commits the YAML but not the feature file), came back empty.
Had that check not been habitual, BL-1277 would simply have read as
never-minted while the human held an approval card for it.

## Bearing on the ON/OFF decision

This is one live tick's behaviour, not a verdict on BL-1236's predicate fix —
the destruction here is the sweep's reset-to-origin doing what it is designed
to do to unpushed local commits, which BL-1236 never claimed to change. It is
offered as the production evidence BL-1251 says it lacked, not as an argument
that BL-1236 failed.

The practical mitigation, which costs nothing and is not currently anywhere in
the role prompts: after committing spec work to `main`, check
`git rev-list --left-right --count main...origin/main` and push when purely
ahead. A commit that reached origin is outside the sweep's reach; a local one
is not, however recently it was restored.
