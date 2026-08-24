# BL-557 — hardener pass, 20260824

## Inbound

Merged architect `08d20da91f` (on cleaner `d91eba8b3e` / coder
`265615f523`) into `swarmforge-hardender`.

## Scope

Graduate Model Steward to coordinator-assignable infrastructure role;
`known_limitations` on registry; `render-compat-docs` / `compat-docs` CLI.
Touches `model_steward_lib.bb`, `model_steward_cli.bb`, schema/seed, prompt,
docs.

## Host / BL-149

Both production `.bb` files: **skip-cooldown** (age ~0.22d). Host quiet.
No Stryker (babashka). Gherkin + surgical this pass.

## BL-113 Gherkin (soft)

```
total=6 completed=6 killed=6 survived=0
outcome: pass
```

## Hand-authored surgical

| Mutant | Result |
|---|---|
| limitations-lines always "(none recorded)" | killed |
| Drop Status line from model section | killed |
| Drop role-matrix section from docs | killed |
| Drop known_limitations on register-model | killed |

Survivors: 0.

## Verification

- Acceptance 7/7; unit ALL PASS
- HOTFIX stamp-off matches board (`27273f2b0a`)

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-557-model-steward-slice3-role-and-compat-docs`.

By hardender.
