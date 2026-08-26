# BL-1150: outage_failover_cli.bb is load-file safe

Certifies ops hotfix `ca45facb4` (`Hotfix-Certification: pending`): handoffd
must be able to `(load-file …/outage_failover_cli.bb)` without the CLI calling
`System/exit`.

## Guard

```clojure
(when (= *file* (System/getProperty "babashka.file"))
  (-main))
```

Same shape as `post_hotfix_merge_origin.bb`. Load-file defines the namespace
and returns; `bb outage_failover_cli.bb <cmd>` still runs `-main`.

## Verify

```bash
bb swarmforge/scripts/test/test_outage_failover_cli_load_file_safe.bb
bb swarmforge/scripts/outage_failover_cli.bb   # usage, non-zero exit
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1150-outage-failover-cli-load-file-safe.feature
```

See also [BL-669 outage failover](BL-669-outage-driven-seat-failover-via-steward.md)
and [hotfix certification](BL-848-certify-an-operator-hotfix.md).
