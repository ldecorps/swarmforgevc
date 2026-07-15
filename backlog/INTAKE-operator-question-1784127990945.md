# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-15T15:06:30.945721959Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Adaptive worker-count for mutation-test runs: size the Stryker/test parallelism from available RAM headroom rather than a fixed core count. The box has 20 cores but the real bottleneck is likely RAM, not cores (orphaned vitest workers have OOM-thrashed this swarm before). Ask: profile peak RSS per worker during a mutation run, then choose concurrency from free-RAM headroom instead of maxing cores. Adjacent to already-approved BL-422 (cap vitest pool/heap for the UNIT suite); this is the mutation-run equivalent and adaptive rather than a fixed cap. Human asked (SUP-2): can mutation tests use more/adaptive cores depending on overall usage, and can this be profiled.
