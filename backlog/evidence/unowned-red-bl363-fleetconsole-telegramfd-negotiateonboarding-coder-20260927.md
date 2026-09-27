# coder pass — two unowned pre-existing reds in BL-363's own guard feature, 2026-09-27

While running BL-1770's qa_e2e_procedure step 2 (`node specs/pipeline/cli.js
specs/features/BL-363-clis-tested-in-process.feature`), two of its five
scenarios fail. Confirmed pre-existing and unrelated to BL-1770: `git diff
aaa1bbc37c HEAD --name-only` (my prior coder commit through the reverse-hop
and QA merge-ups received this session) names no change to
`fleetConsoleCli.test.js`, `telegramFrontDeskBotCli.test.js`, or
`negotiateOnboardingContractCli.test.js` — these three files are
byte-identical to before this session's work, and `briefingDigestLineCli.test.js`
(the only file BL-1770 touches) is named in neither failure.

## D2 — "Each CLI keeps exactly one end-to-end spawn as a wiring smoke test"

```
Then exactly one of them spawns the CLI end to end: expected exactly one
subprocess spawn per CLI test file, found violations: fleetConsoleCli=2,
telegramFrontDeskBotCli=2
```

## D4 — "A test needing a repository fixture builds it once, not once per test"

```
Then the repository fixture is built once and reused: expected the
beforeAll block in negotiateOnboardingContractCli.test.js to run git init
once
```

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `363`, `clis-tested-in-process`,
`fleetConsoleCli`, `telegramFrontDeskBotCli`, `negotiateOnboardingContractCli`
— no row. Grepped `backlog/active`, `backlog/paused` for the same three
file basenames — only BL-791 (unit-suite-speed epic) and BL-1596, both
naming `telegramFrontDeskBotCli` for its own bare-timeout-constant class,
not for a second/extra subprocess spawn — nothing open owns either
scenario's failure.

## Disposition

Filing as one `unowned-red` `note` (priority 00) to specifier and
coordinator per the standing-red rule (2026-09-05), covering both, and
continuing BL-1770's own work — QA will not approve BL-1770 over these
unless registered with an owning ticket by the time it reaches QA.

By coder.
