# Local coder A/B: qwen2.5-coder-14b (BL-1916) vs iq3 (BL-1917) - plan and qwen2.5 baseline

2026-10-03, specifier.

## The human's ruling (verbatim, specifier pane, ~12:20Z)

> Agreed to
>
> How I'd run it:
> Let qwen2.5 handle QA's BL-1916 bounce first. That's the test already queued: can it act on a bounce?
> Then swap the coder seat to iq3 for the next stamp-off (BL-1917, same shape and size), and compare the two runs on the same things: tool calls per parcel, stalls, whether a forward lands, and what QA's bounce inventory says.

## Sequence

1. **qwen2.5 takes QA's BL-1916 bounce.** QA held BL-1916 (50_20261003T121143Z_002383)
   at 12:12Z and was finding placeholder evidence, a file literally named
   `BL-1916-coder-$(date +%Y%m%d).md`, a misleading subject and a missing
   byline. The test is whether the seat acts on the bounce inventory and
   forwards a corrected parcel.
2. **Coordinator routes BL-1917 next, and notes the specifier first.** The
   coder's queue is served oldest-first within a priority. After the bounce
   it would otherwise serve stale Work notes (BL-1908, BL-1456, BL-1861,
   BL-1912, BL-1851) and about a dozen "branch behind - merge up" notes
   before BL-1917's Work note (10_20261003T103936Z_015813). The specifier
   needs a note before BL-1917 is served, so the seat can be swapped first.
3. **Specifier swaps the `coder` seat to `ista-iq3s-coder:latest`.**
   - full-forge.conf's `coder` line: model `qwen2.5-coder-14b-q5km:latest` ->
     `ista-iq3s-coder:latest`, in the working copy only, like the human's
     own uncommitted edit of that line.
   - Regenerate `.swarmforge/launch/coder.sh` with the one-seat recipe
     (SWARMFORGE_PACK + SWARMFORGE_CONFIG set) and diff it against a backup.
     Only the model name lines may change. Then rewrite the seat's
     `.qwen/settings.json` the same way and respawn the pane.
   - Preconditions: the Modelfile pins `num_ctx 49152` and
     `num_predict 4096` (checked 12:20Z). The serving `ollama serve` has
     `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` (check
     `/proc/<pid>/environ` first; without them iq3 spilled to CPU on 09-30).
     And the seat's `think: false` / `reasoning_effort: none` must actually
     reach this thinking-capable model; probe one request through the shim
     before the respawn.
4. **iq3 takes BL-1917** on the same harness (shim, served text, card,
   kickoff). Measure the same things as the baseline below.

## qwen2.5 baseline on BL-1916 (10:44-12:13Z)

From the seat's qwen chat recordings, shim.log and handoffd.log
(`abmetrics.py`: sessions whose first record falls in the window).

| measure | whole run | final post-fix session (8aa47fd1, 12:08-12:13Z) |
|---|---|---|
| sessions | 13 | 1 |
| handoffd chase-respawns | 9 (plus specifier respawns for hotfixes) | 0 |
| tool calls | 169 | 14 |
| text-only stops (reply with no call) | 23 | 1 |
| shim nudges (ok / no-call) | 42 / 1 | - |
| forward landed | yes, 12:11:43Z (about 93 min after the 10:38Z route) | yes, about 4 min after its kickoff |
| QA bounce inventory | 3 items, all `behavior`, all blamed on coder (backlog/evidence/BL-1916-QA-20261003.md at 28965db6b7; bounce f09cf2dfce, 12:25:50Z) | same parcel |

The whole-run numbers are confounded. Ten harness hotfixes landed during
the run (59a376845a ... e2e2287822; BL-1916's own stamp is e022e33baf). The
final session ran on the finished harness, so it is the fair comparison
for iq3's BL-1917 run.

### QA's BL-1916 inventory (first forward, da06baf72d)

- D1: a committed file literally named `BL-1916-coder-$(date +%Y%m%d).md`
  holding `NONE`: written by session ad49be78's ten-call blind batch at
  11:47Z, before 5a89725e03 added the literal-path rule, and committed by
  session 79269ebf's `git add .` (62b66b7b2e). That session never read its
  card.
- D2: the evidence file is the ticket's own instruction sentence ("NONE, or
  one item per defect found.") - no check run, no commit range.
- D3: da06baf72d's subject claims a Modelfile edit it does not contain and
  names no ticket; 62b66b7b2e has no byline.

QA's verdict on the hotfix itself: e022e33baf stands (every check passed).
D1 and D3's byline are harness-addressed now (card-first resume e2e2287822,
the printed forward step aec0daba54). D2 and D3's subject are judgment, the
thing this comparison measures. QA dogfood note 003778 (12:26Z) points at
the same commit. Next measurement: what the qwen2.5 seat does with this bounce.

## Compare on

Tool calls per parcel, stalls (text-only stops, nudges, respawns), whether
the forward lands (and time to it), and QA's bounce inventory (item count
and classes), for BL-1916 after its bounce and for BL-1917 on iq3.
