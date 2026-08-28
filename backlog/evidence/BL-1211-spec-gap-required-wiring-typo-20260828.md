# BL-1211 spec-gap — `required_wiring` names the wrong file (2026-08-28)

Ticket `backlog/active/BL-1211-recovery-resurrects-reverted-bounce-content-and-the-lift-check-is-blind.yaml`
carries:

```yaml
required_wiring:
  - 'extension/src/tools/quarantine-lift-check.ts::quarantineLiftCheck::...'
  - 'extension/src/tools/quarantine-lift-check.ts::filterRecoveryPaths::...'
```

Both entries name `quarantine-lift-check.ts`. The implementation is correct
and complete — `filterRecoveryPaths` is wired into a *separate* CLI,
`extension/src/tools/recovery-filter-check.ts` (confirmed: the function is
imported and called there, not in `quarantine-lift-check.ts`, which only
calls `quarantineLiftCheck`). The second `required_wiring` line's file path
is a typo from mint time and should read:

```yaml
  - 'extension/src/tools/recovery-filter-check.ts::filterRecoveryPaths::...'
```

`swarm_handoff.sh`'s pre-QA wiring gate reads the ticket YAML literally, so
it refuses every `git_handoff` to QA for this task until the YAML is
corrected — the implementation needs no change.

Documenter pass and doc commits for BL-1211 are complete
(`6c5e5842bb`/`80bc968c4d` in `.worktrees/documenter`, ancestor-restored
merge of hardener's two parallel commits `1535f0b0a6`/`9ead4600dc`, which
are functionally identical modulo an evidence-file rename). Once the YAML
is fixed, re-run `swarm_handoff.sh` for task
`BL-1211-recovery-resurrects-reverted-bounce-content-and-the-lift-check-is-blind`
citing `80bc968c4d` (or later) to QA.

By documenter.
